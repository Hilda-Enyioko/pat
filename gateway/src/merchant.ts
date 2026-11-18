// USSD merchant codes. Every wallet gets a 10-digit code the moment it asks (database
// only, free). "Activate" puts code -> wallet on-chain via register_merchant, signed by
// the Config admin, after the wallet signs activationMessage(). Payments to a code can
// only ever reach token accounts owned by that wallet: the program enforces it.
import { randomInt } from "crypto";
import type { Express, Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config";
import { configAdmin, merchantPayout, registerMerchant } from "./chain";
import { q } from "./db";
import { fail, maskPhone } from "./enroll";
import { fromBase } from "./ussd";
import { limiter, verifyWalletSignature } from "./sig";

export const CODE_MIN = 1_000_000_000;
export const CODE_MAX = 4_294_967_295; // u32::MAX, the program's code type

/** Text the wallet signs to activate. Must match app/src/lib/gateway.ts. */
export const activationMessage = (code: number, wallet: string) =>
  [
    "PAT-MERCHANT-v1",
    `code: ${code}`,
    `payout: ${wallet}`,
    "",
    "Sign to receive USSD payments to this wallet under this code. This is not a transaction.",
  ].join("\n");

type Row = { wallet: string; code: string; status: "reserved" | "active"; activated_at: Date | null };

const newCodeLimited = limiter(20, 60 * 60_000);
const activating = new Set<string>();

const out = (r: Row) => ({ wallet: r.wallet, code: Number(r.code), status: r.status });

function parseWallet(v: unknown): PublicKey | null {
  try {
    return new PublicKey(String(v));
  } catch {
    return null;
  }
}

async function reserveCode(wallet: string, ip: string | null): Promise<Row> {
  for (let i = 0; i < 8; i++) {
    const code = randomInt(CODE_MIN, CODE_MAX + 1);
    // Codes registered outside this gateway (scripts, other tools) also count as taken.
    if (await merchantPayout(code)) continue;
    const [row] = await q<Row>(
      `insert into merchant_codes (wallet, code, ip) values ($1,$2,$3)
       on conflict do nothing returning wallet, code, status, activated_at`,
      [wallet, code, ip],
    );
    if (row) return row;
    // Either the code collided or this wallet raced us to a code: re-read.
    const [mine] = await q<Row>("select wallet, code, status, activated_at from merchant_codes where wallet=$1", [wallet]);
    if (mine) return mine;
  }
  throw new Error("could not allocate a merchant code");
}

export function mountMerchant(app: Express) {
  // Get (or create) the wallet's code. Creating one is free and off-chain.
  app.get("/merchant/me/:wallet", async (req: Request, res: Response) => {
    const wallet = parseWallet(req.params.wallet);
    if (!wallet) return fail(res, 400, "bad_wallet");
    try {
      const [row] = await q<Row>("select wallet, code, status, activated_at from merchant_codes where wallet=$1", [wallet.toBase58()]);
      if (row) return res.json({ ...out(row), canActivate: Boolean(config.admin) });
      if (newCodeLimited(req.ip ?? "unknown")) return fail(res, 429, "rate_limited");
      const created = await reserveCode(wallet.toBase58(), req.ip ?? null);
      res.json({ ...out(created), canActivate: Boolean(config.admin) });
    } catch (e) {
      console.error("merchant me error", e);
      fail(res, 500, "internal");
    }
  });

  // Put the code on-chain. The wallet's signature proves it wants payments under this code.
  app.post("/merchant/activate", async (req: Request, res: Response) => {
    const wallet = parseWallet(req.body?.wallet);
    const signature = req.body?.signature;
    if (!wallet || typeof signature !== "string") return fail(res, 400, "bad_request");
    const w = wallet.toBase58();
    if (!config.admin) return fail(res, 503, "activation_unavailable");
    if (activating.has(w)) return fail(res, 409, "activation_in_progress");
    activating.add(w);
    try {
      const [row] = await q<Row>("select wallet, code, status, activated_at from merchant_codes where wallet=$1", [w]);
      if (!row) return fail(res, 404, "no_code");
      const code = Number(row.code);
      if (!verifyWalletSignature(activationMessage(code, w), signature, wallet)) return fail(res, 400, "bad_signature");
      if (row.status === "active") return res.json(out(row));

      const admin = await configAdmin();
      if (!admin?.equals(config.admin.publicKey)) {
        console.error(`ADMIN_KEYPAIR is ${config.admin.publicKey.toBase58()}, on-chain admin is ${admin?.toBase58()}`);
        return fail(res, 503, "activation_unavailable");
      }

      const existing = await merchantPayout(code);
      let tx: string | null = null;
      if (existing && !existing.equals(wallet)) {
        // Someone registered this code on-chain outside the gateway. Give the wallet a new one.
        await q("delete from merchant_codes where wallet=$1", [w]);
        const fresh = await reserveCode(w, req.ip ?? null);
        return fail(res, 409, "code_taken", `That code was taken. Your new code is ${fresh.code}; activate again.`);
      }
      if (!existing) tx = await registerMerchant(code, wallet);
      const [done] = await q<Row>(
        `update merchant_codes set status='active', signature=$2, activated_at=now() where wallet=$1
         returning wallet, code, status, activated_at`,
        [w, tx],
      );
      res.json({ ...out(done), tx });
    } catch (e) {
      console.error("merchant activate error", e);
      fail(res, 500, "internal", "Activation failed on-chain. Try again in a minute.");
    } finally {
      activating.delete(w);
    }
  });

  // USSD payments to this wallet's code, newest first. The keeper settles; the merchant only watches.
  app.get("/merchant/payments/:wallet", async (req: Request, res: Response) => {
    const wallet = parseWallet(req.params.wallet);
    if (!wallet) return fail(res, 400, "bad_wallet");
    try {
      const rows = await q<{
        id: string; merchant_code: string; amount: string; status: string; signature: string | null;
        error: string | null; created_at: Date; updated_at: Date; phone: string; mint: string; decimals: number; symbol: string;
      }>(
        `select p.id, p.merchant_code, p.amount, p.status, p.signature, p.error, p.created_at, p.updated_at,
                e.phone, e.mint, e.decimals, e.symbol
         from payments p
         join enrollments e on e.id = p.enrollment_id
         join merchant_codes m on m.code = p.merchant_code
         where m.wallet = $1
         order by p.created_at desc limit 50`,
        [wallet.toBase58()],
      );
      res.json({
        payments: rows.map((r) => ({
          id: r.id,
          code: Number(r.merchant_code),
          amount: r.amount,
          display: `${fromBase(BigInt(r.amount), r.decimals)} ${r.symbol}`,
          mint: r.mint,
          decimals: r.decimals,
          symbol: r.symbol,
          status: r.status,
          signature: r.signature,
          payer: maskPhone(r.phone),
          createdAt: Math.floor(new Date(r.created_at).getTime() / 1000),
          updatedAt: Math.floor(new Date(r.updated_at).getTime() / 1000),
        })),
      });
    } catch (e) {
      console.error("merchant payments error", e);
      fail(res, 500, "internal");
    }
  });

  // Who does this code pay? Lets a payer check before paying.
  app.get("/merchant/lookup/:code", async (req: Request, res: Response) => {
    const code = Number(req.params.code);
    if (!Number.isInteger(code) || code <= 0 || code > CODE_MAX) return fail(res, 400, "bad_code");
    try {
      const payout = await merchantPayout(code);
      res.json({ code, payout: payout?.toBase58() ?? null, active: Boolean(payout) });
    } catch (e) {
      console.error("merchant lookup error", e);
      fail(res, 500, "internal");
    }
  });
}
