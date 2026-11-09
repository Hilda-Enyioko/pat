// PWA enrollment: the browser can't hold the shared ENROLL_TOKEN, so a phone is
// enrolled by proving two things instead:
//   1. control of the phone  -> an SMS one-time code
//   2. control of the wallet -> an ed25519 signature by the reservation owner
// over a message binding domain, reservation, phone, challenge id and expiry.
import { createHash, createPublicKey, randomBytes, randomInt, timingSafeEqual, verify } from "crypto";
import type { Express, Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { utils } from "@coral-xyz/anchor";
import { config } from "./config";
import { connection, program, readReservation } from "./chain";
import { pool, q } from "./db";
import { hashPin, validPinFormat } from "./pin";
import { notify } from "./sms";

const PHONE_RE = /^\+\d{8,15}$/;
const fail = (res: Response, status: number, error: string, message?: string) =>
  res.status(status).json({ error, ...(message ? { message } : {}) });

export const maskPhone = (p: string) =>
  p.length > 8 ? `${p.slice(0, 4)}${"*".repeat(p.length - 8)}${p.slice(-4)}` : p;

const otpHash = (challengeId: string, otp: string) =>
  createHash("sha256").update(`${challengeId}:${otp}:${config.pinPepper}`).digest("hex");

// Raw 32-byte ed25519 key -> SPKI DER, so node's crypto can verify without extra deps.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function verifyEd25519(message: Buffer, signature: Buffer, pubkey: PublicKey) {
  if (signature.length !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pubkey.toBuffer()]), format: "der", type: "spki" });
  return verify(null, message, key, signature);
}

// Per-IP limit on challenge requests (each one sends an SMS). In memory: one instance.
const ipHits = new Map<string, number[]>();
function ipLimited(ip: string, max = 10, windowMs = 10 * 60_000) {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > max;
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

  app.post("/enroll/challenge", async (req: Request, res: Response) => {
    try {
      const { phone, reservation } = req.body ?? {};
      if (typeof phone !== "string" || !PHONE_RE.test(phone)) return fail(res, 400, "bad_phone");
      let key: PublicKey;
      try {
        key = new PublicKey(reservation);
      } catch {
        return fail(res, 400, "reservation_not_found");
      }
      if (ipLimited(req.ip ?? "unknown")) return fail(res, 429, "rate_limited");
      const [{ n }] = await q<{ n: string }>(
        `select count(*) as n from enroll_challenges where phone=$1 and created_at > now() - interval '10 minutes'`,
        [phone],
      );
      if (Number(n) >= config.challengesPerPhonePer10Min) return fail(res, 429, "rate_limited");

      const r = await readReservation(key);
      if (!r) return fail(res, 404, "reservation_not_found");
      if (!r.mint || r.delegate?.toBase58() !== config.keeper.publicKey.toBase58()) return fail(res, 400, "not_delegated");
      if (r.expiresAt * 1000 <= Date.now()) return fail(res, 400, "reservation_expired");

      const [taken] = await q<{ phone: string }>("select phone from enrollments where reservation=$1", [key.toBase58()]);
      if (taken && taken.phone !== phone) return fail(res, 409, "reservation_taken");
      const [existing] = await q<{ reservation: string }>("select reservation from enrollments where phone=$1", [phone]);

      const { decimals } = await getMint(connection, r.mint);
      const symbol = config.mints.find((m) => m.mint === r.mint!.toBase58())?.symbol ?? "USDC";
      const id = randomBytes(16).toString("hex");
      const expiresAt = new Date(Date.now() + config.otpMinutes * 60_000);
      const origin = req.get("origin") ?? "unknown";
      const message = [
        "PAT-ENROLL-v1",
        `domain: ${origin}`,
        `reservation: ${key.toBase58()}`,
        `phone: ${phone}`,
        `challenge: ${id}`,
        `expires: ${expiresAt.toISOString()}`,
        "",
        "Sign to link this phone to your PAT reservation for USSD payments. This is not a transaction.",
      ].join("\n");
      const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");

      await q(
        `insert into enroll_challenges (id, phone, reservation, owner, mint, decimals, symbol, message, otp_hash, ip, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, phone, key.toBase58(), r.owner.toBase58(), r.mint.toBase58(), decimals, symbol, message, otpHash(id, otp), req.ip ?? null, expiresAt],
      );
      await notify(phone, `PAT code: ${otp}. It links this phone to a PAT reservation. Expires in ${config.otpMinutes} min. Don't share it.`);

      res.json({
        challengeId: id,
        message,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
        phoneAlreadyEnrolled: Boolean(existing && existing.reservation !== key.toBase58()),
      });
    } catch (e) {
      console.error("challenge error", e);
      fail(res, 500, "internal");
    }
  });

  app.post("/enroll/confirm", async (req: Request, res: Response) => {
    const { challengeId, otp, pin, signature } = req.body ?? {};
    if (typeof challengeId !== "string" || typeof otp !== "string" || typeof signature !== "string")
      return fail(res, 400, "bad_request");
    if (typeof pin !== "string" || !validPinFormat(pin)) return fail(res, 400, "bad_pin");

    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query("select * from enroll_challenges where id=$1 for update", [challengeId]);
      const c = rows[0];
      if (!c) {
        await client.query("rollback");
        return fail(res, 400, "challenge_expired");
      }
      if (c.used) {
        await client.query("rollback");
        return fail(res, 400, "challenge_used");
      }
      if (new Date(c.expires_at) <= new Date()) {
        await client.query("update enroll_challenges set used=true where id=$1", [c.id]);
        await client.query("commit");
        return fail(res, 400, "challenge_expired");
      }

      const expected = Buffer.from(c.otp_hash, "hex");
      const got = Buffer.from(otpHash(c.id, otp.trim()), "hex");
      if (!timingSafeEqual(expected, got)) {
        const attempts = c.attempts + 1;
        const burned = attempts >= config.otpMaxAttempts;
        await client.query("update enroll_challenges set attempts=$2, used=$3 where id=$1", [c.id, attempts, burned]);
        await client.query("commit");
        return fail(res, 400, burned ? "too_many_attempts" : "otp_invalid");
      }

      let sig: Buffer;
      try {
        sig = Buffer.from(utils.bytes.bs58.decode(signature));
      } catch {
        await client.query("rollback");
        return fail(res, 400, "bad_signature");
      }
      if (!verifyEd25519(Buffer.from(c.message, "utf8"), sig, new PublicKey(c.owner))) {
        await client.query("rollback");
        return fail(res, 400, "bad_signature");
      }

      // Re-check the chain: the reservation may have expired or been withdrawn since.
      const r = await readReservation(new PublicKey(c.reservation));
      if (!r) {
        await client.query("rollback");
        return fail(res, 404, "reservation_not_found");
      }
      if (r.expiresAt * 1000 <= Date.now()) {
        await client.query("rollback");
        return fail(res, 400, "reservation_expired");
      }
      if (r.owner.toBase58() !== c.owner || r.delegate?.toBase58() !== config.keeper.publicKey.toBase58()) {
        await client.query("rollback");
        return fail(res, 400, "not_delegated");
      }

      // Moving a phone to a new reservation while a payment is queued would settle
      // that payment against the new reservation. Make the user wait instead.
      const inflight = await client.query(
        `select 1 from payments p join enrollments e on e.id = p.enrollment_id
         where e.phone=$1 and e.reservation<>$2 and p.status in ('pending','sending') limit 1`,
        [c.phone, c.reservation],
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
        [c.phone, c.owner, c.reservation, c.mint, c.decimals, c.symbol, await hashPin(pin)],
      );
      await client.query("update enroll_challenges set used=true where id=$1", [c.id]);
      await client.query("commit");
      res.json({ ok: true, phoneMasked: maskPhone(c.phone) });
    } catch (e: any) {
      await client.query("rollback").catch(() => undefined);
      if (e?.code === "23505") return fail(res, 409, "reservation_taken");
      console.error("confirm error", e);
      fail(res, 500, "internal");
    } finally {
      client.release();
    }
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
