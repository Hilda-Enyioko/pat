import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export const INTENT_DOMAIN = "PAT-INTENT-v1";
export const SIGNED_LEN = 179; // 13 domain + 166 body

export type Intent = {
  version: number;
  cluster: number;
  paymentId: Buffer; // 32 bytes
  payer: PublicKey;
  merchant: PublicKey;
  reservation: PublicKey;
  amount: BN;
  createdAt: BN;
  expiresAt: BN;
  sequence: number;
  committedAfter: BN;
};

// FIELD ORDER IS PART OF THE FORMAT (must match PaymentIntent::signing_bytes in Rust).
export function intentSigningBytes(i: Intent): Buffer {
  const buf = Buffer.alloc(SIGNED_LEN);
  let o = 0;
  o += buf.write(INTENT_DOMAIN, o, "ascii");
  buf.writeUInt8(i.version, o); o += 1;
  buf.writeUInt8(i.cluster, o); o += 1;
  if (i.paymentId.length !== 32) throw new Error("paymentId must be 32 bytes");
  i.paymentId.copy(buf, o); o += 32;
  i.payer.toBuffer().copy(buf, o); o += 32;
  i.merchant.toBuffer().copy(buf, o); o += 32;
  i.reservation.toBuffer().copy(buf, o); o += 32;
  buf.writeBigUInt64LE(BigInt(i.amount.toString()), o); o += 8;
  buf.writeBigInt64LE(BigInt(i.createdAt.toString()), o); o += 8;
  buf.writeBigInt64LE(BigInt(i.expiresAt.toString()), o); o += 8;
  buf.writeUInt32LE(i.sequence, o); o += 4;
  buf.writeBigUInt64LE(BigInt(i.committedAfter.toString()), o); o += 8;
  if (o !== SIGNED_LEN) throw new Error(`bad length ${o}`);
  return buf;
}

// Shape Anchor expects for the `intent` instruction argument.
export function toProgramIntent(i: Intent) {
  return {
    version: i.version,
    cluster: i.cluster,
    paymentId: Array.from(i.paymentId),
    payer: i.payer,
    merchant: i.merchant,
    reservation: i.reservation,
    amount: i.amount,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    sequence: i.sequence,
    committedAfter: i.committedAfter,
  };
}
