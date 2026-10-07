import { Buffer } from "buffer";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM_ID } from "../config";

const te = new TextEncoder();

// Must match programs/pat/src/constants.rs and state.rs
export const RESERVATION_SEED = te.encode("reservation");
export const PAYMENT_SEED = te.encode("payment");
export const RESERVATION_SPACE = 109;
export const PAYMENT_SPACE = 174;

// ---------- byte helpers ----------
const concat = (parts: Uint8Array[]): Uint8Array => {
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
  const data = concat([
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
