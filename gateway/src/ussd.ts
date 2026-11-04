import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { q } from "./db";
import { config } from "./config";
import { merchantPayout, readReservation } from "./chain";
import { verifyPin } from "./pin";

export type UssdInput = { sessionId: string; phone: string; text: string };
type Enr = {
  id: string; phone: string; reservation: string; mint: string; decimals: number;
  symbol: string; pin_hash: string; failed_attempts: number; locked_until: Date | null;
};

const con = (s: string) => `CON ${s}`;
const end = (s: string) => `END ${s}`;

export function toBase(s: string, decimals: number): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  if (f.length > decimals) return null;
  const v = BigInt(i + f.padEnd(decimals, "0"));
  return v > 0n ? v : null;
}

export function fromBase(v: bigint, decimals: number): string {
  if (decimals === 0) return v.toString();
  const s = v.toString().padStart(decimals + 1, "0");
  const out = `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
  return out.replace(/\.?0+$/, "") || "0";
}

const pendingSum = async (enrId: string) =>
  BigInt((await q<{ s: string }>(
    `select coalesce(sum(amount),0) as s from payments
     where enrollment_id=$1 and status in ('pending','sending')`, [enrId]))[0].s);

async function checkPin(enr: Enr, pin: string): Promise<string | null> {
  const now = new Date();
  if (enr.locked_until && enr.locked_until > now) return "PIN locked. Try again later.";
  if (enr.locked_until) {
    await q("update enrollments set failed_attempts=0, locked_until=null where id=$1", [enr.id]);
    enr.failed_attempts = 0;
  }
  if (await verifyPin(enr.pin_hash, pin)) {
    if (enr.failed_attempts)
      await q("update enrollments set failed_attempts=0 where id=$1", [enr.id]);
    return null;
  }
  const [u] = await q<{ failed_attempts: number }>(
    `update enrollments set
       failed_attempts = failed_attempts + 1,
       locked_until = case when failed_attempts + 1 >= $2
                      then now() + make_interval(mins => $3) else locked_until end
     where id=$1 returning failed_attempts`,
    [enr.id, config.maxPinAttempts, config.lockMinutes]);
  const left = config.maxPinAttempts - u.failed_attempts;
  return left > 0 ? `Wrong PIN. ${left} attempt(s) left.` : "Wrong PIN. PIN locked.";
}

export async function handleUssd({ sessionId, phone, text }: UssdInput): Promise<string> {
  const [enr] = await q<Enr>("select * from enrollments where phone=$1", [phone]);
  if (!enr) return end("This number is not set up for PAT. Open the PAT app to enable USSD.");

  const steps = text === "" ? [] : text.split("*");
  if (steps.length === 0) return con("PAT\n1. Pay merchant\n2. Balance");

  const [choice, a, b, c] = steps;

  if (choice === "2") {
    if (steps.length === 1) return con("Enter PIN:");
    if (steps.length > 2) return end("Invalid choice.");
    const bad = await checkPin(enr, a);
    return bad ? end(bad) : balance(enr);
  }

  if (choice !== "1" || steps.length > 4) return end("Invalid choice.");
  if (steps.length === 1) return con("Merchant code:");

  if (!/^\d{1,9}$/.test(a) || Number(a) === 0) return end("Invalid merchant code.");
  const merchantCode = Number(a);
  if (!(await merchantPayout(merchantCode))) return end("Unknown merchant code.");
  if (steps.length === 2) return con(`Amount (${enr.symbol}):`);

  const amount = toBase(b, enr.decimals);
  if (amount === null) return end("Invalid amount.");
  const shown = `${fromBase(amount, enr.decimals)} ${enr.symbol}`;
  if (steps.length === 3) return con(`Pay ${shown} to merchant ${merchantCode}.\nEnter PIN:`);

  return pay(enr, sessionId, merchantCode, amount, shown, c);
}

async function balance(enr: Enr): Promise<string> {
  const r = await readReservation(new PublicKey(enr.reservation));
  if (!r) return end("Reservation not found.");
  const left = r.capacity - r.committed - (await pendingSum(enr.id));
  const exp = new Date(r.expiresAt * 1000).toISOString().slice(0, 16).replace("T", " ");
  return end(`Available: ${fromBase(left < 0n ? 0n : left, enr.decimals)} ${enr.symbol}\nExpires: ${exp} UTC`);
}

async function pay(
  enr: Enr, sessionId: string, merchantCode: number, amount: bigint, shown: string, pin: string
): Promise<string> {
  const bad = await checkPin(enr, pin);
  if (bad) return end(bad);

  const r = await readReservation(new PublicKey(enr.reservation));
  if (!r) return end("Reservation not found.");
  if (Date.now() / 1000 >= r.expiresAt) return end("Your reservation has expired. Renew it in the PAT app.");
  if (amount > r.perPaymentCap)
    return end(`Maximum per payment is ${fromBase(r.perPaymentCap, enr.decimals)} ${enr.symbol}.`);
  if (amount > r.capacity - r.committed - (await pendingSum(enr.id)))
    return end("Insufficient reserved balance.");

  const paymentId = createHash("sha256").update(`pat-ussd:${sessionId}`).digest();
  await q(
    `insert into payments (session_id, payment_id, enrollment_id, merchant_code, amount)
     values ($1,$2,$3,$4,$5) on conflict (session_id) do nothing`,
    [sessionId, paymentId, enr.id, merchantCode, amount.toString()]);

  return end(`Payment of ${shown} to merchant ${merchantCode} submitted. You will get an SMS.`);
}
