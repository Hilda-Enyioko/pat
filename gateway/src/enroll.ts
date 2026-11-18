// PWA enrollment. The browser can't hold the shared ENROLL_TOKEN, so a phone is
// enrolled by proving two things:
//   1. control of the phone  -> the user dials the USSD code from that phone and
//      types the 6-digit link code the app shows (see linkPhone, used by ussd.ts)
//   2. control of the wallet -> either the reserve transaction itself carries a memo
//      "PAT-ENROLL-v2 <linkId>" signed by the owner (one wallet approval), or, for a
//      reservation that already exists, a signMessage over enrollMessage().
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { config } from "./config";
import { connection, program, readReservation } from "./chain";
import { pool, q } from "./db";
import { hashPin, validPinFormat } from "./pin";
import { notify } from "./sms";
import { limiter, verifyWalletSignature } from "./sig";

export const PHONE_RE = /^\+\d{8,15}$/;
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export const fail = (res: Response, status: number, error: string, message?: string) =>
  res.status(status).json({ error, ...(message ? { message } : {}) });

export const maskPhone = (p: string) =>
  p.length > 8 ? `${p.slice(0, 4)}${"*".repeat(p.length - 8)}${p.slice(-4)}` : p;

const codeHash = (linkId: string, code: string) =>
  createHash("sha256").update(`${linkId}:${code}:${config.pinPepper}`).digest("hex");

/** Memo the reserve transaction carries. Must match app/src/lib/gateway.ts. */
export const enrollMemo = (linkId: string) => `PAT-ENROLL-v2 ${linkId}`;

/** Text signed for an existing reservation. Must match app/src/lib/gateway.ts. */
export const enrollMessage = (linkId: string, phone: string, reservation: string) =>
  [
    "PAT-ENROLL-v2",
    `link: ${linkId}`,
    `phone: ${phone}`,
    `reservation: ${reservation}`,
    "",
    "Sign to let this phone pay from this reservation over USSD. This is not a transaction.",
  ].join("\n");

const startLimited = limiter(10, 10 * 60_000);

/**
 * Called from the USSD menu: the dialling phone enters a link code.
 * Returns the text to show on the phone.
 */
export async function linkPhone(phone: string, code: string): Promise<string> {
  if (!/^\d{6}$/.test(code)) return "That code should be 6 digits.";
  const open = await q<{ id: string; code_hash: string; attempts: number }>(
    `select id, code_hash, attempts from enroll_links
     where phone=$1 and not used and verified_at is null and expires_at > now()
     order by created_at desc limit 5`,
    [phone],
  );
  if (!open.length) return "No open link request for this number. Start again in the PAT app.";
  const match = open.find((l) =>
    timingSafeEqual(Buffer.from(l.code_hash, "hex"), Buffer.from(codeHash(l.id, code), "hex")),
  );
  if (match) {
    await q("update enroll_links set verified_at=now() where id=$1", [match.id]);
    return "Phone linked. Go back to the PAT app to finish.";
  }
  await q(
    `update enroll_links set attempts = attempts + 1, used = (attempts + 1 >= $2) where id = any($1)`,
    [open.map((l) => l.id), config.linkMaxAttempts],
  );
  return "Wrong code. Check the PAT app and try again.";
}

/** The owner signed a transaction carrying our memo, and it touched the reservation. */
async function txProvesOwner(signature: string, owner: string, reservation: string, linkId: string) {
  let tx = null;
  for (const wait of [0, 1500, 3000, 5000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx) break;
  }
  if (!tx) return "tx_not_found";
  if (tx.meta?.err) return "tx_failed";
  const msg = tx.transaction.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const ownerIdx = keys.indexOf(owner);
  if (ownerIdx < 0 || !msg.isAccountSigner(ownerIdx)) return "bad_signature";
  if (!keys.includes(reservation)) return "bad_signature";
  const memo = enrollMemo(linkId);
  const hasMemo = msg.compiledInstructions.some(
    (ix) => keys[ix.programIdIndex] === MEMO_PROGRAM && Buffer.from(ix.data).toString("utf8") === memo,
  );
  return hasMemo ? null : "bad_signature";
}

async function supportedMints() {
  const listed = await Promise.all(
    config.mints.map(async ({ mint, symbol }) => {
      try {
        const { decimals } = await getMint(connection, new PublicKey(mint));
        return { mint, symbol, decimals };
      } catch {
        return null;
      }
    }),
  );
  const out = listed.filter((m): m is { mint: string; symbol: string; decimals: number } => m !== null);
  if (out.length || config.cluster !== "devnet") return out;
  // Devnet convenience: offer mints that are already in use here (e.g. the seed script's).
  return q<{ mint: string; symbol: string; decimals: number }>(
    `select distinct on (mint) mint, symbol, decimals from enrollments order by mint, created_at desc limit 10`,
  );
}

let metaCache: { at: number; body: unknown } | null = null;

export function mountEnroll(app: Express) {
  app.get("/meta", async (_req, res) => {
    try {
      if (!metaCache || Date.now() - metaCache.at > 60_000) {
        metaCache = {
          at: Date.now(),
          body: {
            keeper: config.keeper.publicKey.toBase58(),
            programId: program.programId.toBase58(),
            cluster: config.cluster,
            serviceCode: config.serviceCode,
            sandbox: config.at.username === "sandbox" || !config.at.username,
            merchantActivation: Boolean(config.admin),
            mints: await supportedMints(),
          },
        };
      }
      res.json(metaCache.body);
    } catch (e) {
      console.error("meta error", e);
      fail(res, 500, "internal");
    }
  });

  // Step 1: the app asks for a link code for (phone, wallet).
  app.post("/enroll/start", async (req: Request, res: Response) => {
    try {
      const { phone, owner } = req.body ?? {};
      if (typeof phone !== "string" || !PHONE_RE.test(phone)) return fail(res, 400, "bad_phone");
      try {
        new PublicKey(owner);
      } catch {
        return fail(res, 400, "bad_owner");
      }
      if (startLimited(req.ip ?? "unknown")) return fail(res, 429, "rate_limited");
      const [{ n }] = await q<{ n: string }>(
        `select count(*) as n from enroll_links where phone=$1 and created_at > now() - interval '10 minutes'`,
        [phone],
      );
      if (Number(n) >= config.linksPerPhonePer10Min) return fail(res, 429, "rate_limited");

      const id = randomBytes(16).toString("hex");
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(Date.now() + config.linkMinutes * 60_000);
      await q(
        `insert into enroll_links (id, phone, owner, code_hash, ip, expires_at) values ($1,$2,$3,$4,$5,$6)`,
        [id, phone, owner, codeHash(id, code), req.ip ?? null, expiresAt],
      );
      const [existing] = await q<{ reservation: string }>("select reservation from enrollments where phone=$1", [phone]);
      res.json({
        linkId: id,
        linkCode: code,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
        serviceCode: config.serviceCode,
        phoneAlreadyEnrolled: Boolean(existing),
      });
    } catch (e) {
      console.error("start error", e);
      fail(res, 500, "internal");
    }
  });

  // Step 2: the app polls until the phone has dialled in with the code.
  app.get("/enroll/link/:id", async (req: Request, res: Response) => {
    try {
      const [l] = await q<{ verified_at: Date | null; used: boolean; expires_at: Date }>(
        "select verified_at, used, expires_at from enroll_links where id=$1",
        [String(req.params.id)],
      );
      if (!l) return fail(res, 404, "link_not_found");
      res.json({
        verified: Boolean(l.verified_at),
        used: l.used,
        expired: new Date(l.expires_at) <= new Date(),
      });
    } catch (e) {
      console.error("link status error", e);
      fail(res, 500, "internal");
    }
  });

  // Step 3: bind the verified phone + PIN to a reservation the wallet owns.
  app.post("/enroll/finish", async (req: Request, res: Response) => {
    const { linkId, reservation, pin, txSignature, signature } = req.body ?? {};
    if (typeof linkId !== "string" || typeof reservation !== "string") return fail(res, 400, "bad_request");
    if (typeof pin !== "string" || !validPinFormat(pin)) return fail(res, 400, "bad_pin");
    if (typeof txSignature !== "string" && typeof signature !== "string") return fail(res, 400, "bad_signature");
    let key: PublicKey;
    try {
      key = new PublicKey(reservation);
    } catch {
      return fail(res, 400, "reservation_not_found");
    }

    const [l] = await q<{ id: string; phone: string; owner: string; verified_at: Date | null; used: boolean; expires_at: Date }>(
      "select * from enroll_links where id=$1",
      [linkId],
    );
    if (!l || new Date(l.expires_at) <= new Date()) return fail(res, 400, "link_expired");
    if (l.used) return fail(res, 400, "link_used");
    if (!l.verified_at) return fail(res, 400, "phone_not_verified");

    // Wallet proof, outside the DB transaction: it may wait on the RPC.
    if (typeof txSignature === "string") {
      const err = await txProvesOwner(txSignature, l.owner, key.toBase58(), l.id);
      if (err) return fail(res, 400, err);
    } else if (!verifyWalletSignature(enrollMessage(l.id, l.phone, key.toBase58()), signature, new PublicKey(l.owner))) {
      return fail(res, 400, "bad_signature");
    }

    const r = await readReservation(key);
    if (!r) return fail(res, 404, "reservation_not_found");
    if (r.owner.toBase58() !== l.owner) return fail(res, 400, "bad_signature");
    if (!r.mint || r.delegate?.toBase58() !== config.keeper.publicKey.toBase58()) return fail(res, 400, "not_delegated");
    if (r.expiresAt * 1000 <= Date.now()) return fail(res, 400, "reservation_expired");
    const { decimals } = await getMint(connection, r.mint);
    const symbol = config.mints.find((m) => m.mint === r.mint!.toBase58())?.symbol ?? "USDC";
    const pinHash = await hashPin(pin);

    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query("select used from enroll_links where id=$1 for update", [l.id]);
      if (rows[0]?.used) {
        await client.query("rollback");
        return fail(res, 400, "link_used");
      }
      const taken = await client.query("select phone from enrollments where reservation=$1", [key.toBase58()]);
      if (taken.rows[0] && taken.rows[0].phone !== l.phone) {
        await client.query("rollback");
        return fail(res, 409, "reservation_taken");
      }
      // Moving a phone to a new reservation while a payment is queued would settle
      // that payment against the new reservation. Make the user wait instead.
      const inflight = await client.query(
        `select 1 from payments p join enrollments e on e.id = p.enrollment_id
         where e.phone=$1 and e.reservation<>$2 and p.status in ('pending','sending') limit 1`,
        [l.phone, key.toBase58()],
      );
      if (inflight.rowCount) {
        await client.query("rollback");
        return fail(res, 409, "payments_in_flight", "A payment from this phone is still processing. Try again in a minute.");
      }
      await client.query(
        `insert into enrollments (phone, owner, reservation, mint, decimals, symbol, pin_hash)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (phone) do update set
           owner=excluded.owner, reservation=excluded.reservation, mint=excluded.mint,
           decimals=excluded.decimals, symbol=excluded.symbol, pin_hash=excluded.pin_hash,
           failed_attempts=0, locked_until=null`,
        [l.phone, l.owner, key.toBase58(), r.mint.toBase58(), decimals, symbol, pinHash],
      );
      await client.query("update enroll_links set used=true where id=$1", [l.id]);
      await client.query("commit");
    } catch (e: any) {
      await client.query("rollback").catch(() => undefined);
      if (e?.code === "23505") return fail(res, 409, "reservation_taken");
      console.error("finish error", e);
      return fail(res, 500, "internal");
    } finally {
      client.release();
    }
    void notify(l.phone, `PAT: this phone can now pay over USSD. Dial ${config.serviceCode}. Never share your PIN.`);
    res.json({ ok: true, phoneMasked: maskPhone(l.phone) });
  });

  app.get("/enroll/status/:reservation", async (req: Request, res: Response) => {
    try {
      const [row] = await q<{ phone: string }>("select phone from enrollments where reservation=$1", [String(req.params.reservation)]);
      res.json(row ? { enrolled: true, phoneMasked: maskPhone(row.phone) } : { enrolled: false });
    } catch (e) {
      console.error("status error", e);
      fail(res, 500, "internal");
    }
  });
}
