import { Buffer } from "buffer";
import { Connection, Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import type { SignedIntentPayload } from "./intent";
import { PROGRAM_ID } from "../config";

const te = new TextEncoder();

export const RESERVATION_SEED = te.encode("reservation");
export const PAYMENT_SEED = te.encode("payment");
export const RESERVATION_SPACE = 109;
export const PAYMENT_SPACE = 174;

// ---------- byte helpers ----------
export const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const u64le = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
export const i64le = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, n, true); return b; };
export const u32le = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };

// Anchor discriminator = first 8 bytes of sha256("global:<ix>") or sha256("account:<Name>")
const discCache = new Map<string, Uint8Array>();
async function discriminator(preimage: string): Promise<Uint8Array> {
  let d = discCache.get(preimage);
  if (!d) {
    const hash = await crypto.subtle.digest("SHA-256", te.encode(preimage)); // needs https or localhost
    d = new Uint8Array(hash).slice(0, 8);
    discCache.set(preimage, d);
  }
  return d;
}

// ---------- PDAs ----------
export function findReservationPda(owner: PublicKey, reservationId: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [RESERVATION_SEED, owner.toBytes(), u64le(reservationId)],
    PROGRAM_ID,
  );
}

export function derivePaymentPda(reservation: PublicKey, paymentId: Uint8Array): [PublicKey, number] {
  if (paymentId.length !== 32) throw new Error("payment_id must be 32 bytes");
  return PublicKey.findProgramAddressSync([PAYMENT_SEED, reservation.toBytes(), paymentId], PROGRAM_ID);
}

export async function buildSettleIx({ settler, intent, signature }: { settler: PublicKey; intent: SignedIntentPayload; signature: Uint8Array }): Promise<TransactionInstruction[]> {
  if (signature.length !== 64) throw new Error("signature must be 64 bytes");
  const [payment] = derivePaymentPda(intent.reservation, intent.paymentId);
  const ed25519 = Ed25519Program.createInstructionWithPublicKey({
    publicKey: intent.payer.toBytes(),
    message: (await import("./intent")).serializeIntentSigningBytes(intent),
    signature,
  });
  const settleData = concatBytes([
    await discriminator("global:settle"),
    new Uint8Array([intent.version, intent.cluster]), intent.paymentId,
    intent.payer.toBytes(), intent.merchant.toBytes(), intent.reservation.toBytes(),
    u64le(intent.amount), i64le(intent.createdAt), i64le(intent.expiresAt),
    u32le(intent.sequence), u64le(intent.committedAfter),
  ]);
  const settle = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: settler, isSigner: true, isWritable: true },
      { pubkey: intent.reservation, isSigner: false, isWritable: true },
      { pubkey: intent.merchant, isSigner: false, isWritable: true },
      { pubkey: payment, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(settleData),
  });
  return [ed25519, settle];
}

export function mapProgramError(err: unknown, logs?: string[]): string {
  const text = `${err instanceof Error ? err.message : String(err)} ${logs?.join(" ") ?? ""}`.toLowerCase();
  if (text.includes("already in use") || text.includes("account already exists")) return "Already settled";
  if (text.includes("merchant") && text.includes("match")) return "Merchant account does not match the signed payment.";
  if (text.includes("invalidintentwindow") || text.includes("invalid intent window")) return "Invalid intent window; the customer's device clock may have been off. Ask for a new payment.";
  if (text.includes("rentreserveexhausted") || text.includes("rent reserve")) return "The reservation cannot cover payment account rent.";
  if (text.includes("lamportinvariantbroken") || text.includes("lamport invariant")) return "The reservation balance invariant was violated.";
  if (text.includes("exceedsperpaymentcap") || text.includes("per-payment cap")) return "The payment exceeds the reservation per-payment cap.";
  if (text.includes("insufficientcapacity") || text.includes("capacity")) return "The reservation has insufficient remaining capacity.";
  if (text.includes("settlewindowclosed") || text.includes("settlement window")) return "The settlement deadline has passed.";
  if (text.includes("invalidsignature") || text.includes("signature") || text.includes("ed25519")) return "The on-chain signature verification failed.";
  return err instanceof Error ? err.message : "Settlement failed.";
}

// ---------- reserve ----------
export interface ReserveParams {
  owner: PublicKey;
  reservationId: bigint;
  capacity: bigint;       // lamports
  perPaymentCap: bigint;  // lamports
  expiresAt: bigint;      // unix seconds
  maxPayments: number;
}

export async function buildReserveIx(p: ReserveParams) {
  const [reservation] = findReservationPda(p.owner, p.reservationId);
  const data = concatBytes([
    await discriminator("global:reserve"),
    u64le(p.reservationId),
    u64le(p.capacity),
    u64le(p.perPaymentCap),
    i64le(p.expiresAt),
    u32le(p.maxPayments),
  ]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: p.owner, isSigner: true, isWritable: true },        // owner
      { pubkey: reservation, isSigner: false, isWritable: true },   // reservation (PDA, init)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
  return { ix, reservation };
}

// ---------- withdraw ----------
export async function buildWithdrawIx(reservation: PublicKey, owner: PublicKey) {
  const data = await discriminator("global:withdraw");
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: reservation, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

// ---------- Reservation account ----------
export interface ReservationAccount {
  owner: PublicKey;
  reservationId: bigint;
  capacity: bigint;
  committed: bigint;
  rentReserve: bigint;
  perPaymentCap: bigint;
  paymentsSettled: number;
  createdAt: bigint;
  expiresAt: bigint;
  settleDeadline: bigint;
  bump: number;
}

export function decodeReservation(data: Uint8Array): ReservationAccount {
  if (data.length < RESERVATION_SPACE) throw new Error(`Reservation data too short: ${data.length}`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8; // skip discriminator
  const owner = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const u64 = () => { const v = dv.getBigUint64(o, true); o += 8; return v; };
  const i64 = () => { const v = dv.getBigInt64(o, true); o += 8; return v; };
  const reservationId = u64();
  const capacity = u64();
  const committed = u64();
  const rentReserve = u64();
  const perPaymentCap = u64();
  const paymentsSettled = dv.getUint32(o, true); o += 4;
  const createdAt = i64();
  const expiresAt = i64();
  const settleDeadline = i64();
  const bump = dv.getUint8(o);
  return { owner, reservationId, capacity, committed, rentReserve, perPaymentCap,
           paymentsSettled, createdAt, expiresAt, settleDeadline, bump };
}

/** null = account does not exist (never created, or closed by withdraw). */
export async function fetchReservation(c: Connection, address: PublicKey): Promise<ReservationAccount | null> {
  const info = await c.getAccountInfo(address, "confirmed");
  if (!info) return null;
  if (!info.owner.equals(PROGRAM_ID)) throw new Error("Account is not owned by the PAT program");
  return decodeReservation(info.data);
}

/** Chain time, so expires_at is computed against the same clock the program uses. */
export async function chainNow(c: Connection): Promise<number> {
  try {
    const t = await c.getBlockTime(await c.getSlot("confirmed"));
    if (t) return t;
  } catch { /* fall through */ }
  return Math.floor(Date.now() / 1000);
}
