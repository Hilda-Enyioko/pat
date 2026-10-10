import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { u32le, u64le, i64le } from "./pat";

export const INTENT_DOMAIN = new TextEncoder().encode("PAT-INTENT-v1");
export const INTENT_VERSION = 1;
export const DEVNET_CLUSTER_ID = 1;

export interface PaymentIntent {
  version: number;
  cluster: number;
  paymentId: Uint8Array;
  payer: PublicKey;
  merchant: PublicKey;
  reservation: PublicKey;
  amount: bigint;
  createdAt: bigint;
  expiresAt: bigint;
  sequence: number;
  committedAfter: bigint;
}

export interface SignedIntentPayload {
  v: 1;
  intent: {
    version: number;
    cluster: number;
    payment_id: string;
    payer: string;
    merchant: string;
    reservation: string;
    amount: string;
    created_at: string;
    expires_at: string;
    sequence: number;
    committed_after: string;
  };
  signature: string;
}

export function buildIntent(input: Omit<PaymentIntent, "version" | "cluster"> & Partial<Pick<PaymentIntent, "version" | "cluster">>): PaymentIntent {
  if (input.paymentId.length !== 32) throw new Error("paymentId must be 32 bytes");
  return { version: INTENT_VERSION, cluster: DEVNET_CLUSTER_ID, ...input };
}

export function serializeIntentSigningBytes(intent: PaymentIntent): Uint8Array {
  if (intent.paymentId.length !== 32) throw new Error("paymentId must be 32 bytes");
  return concat([INTENT_DOMAIN, new Uint8Array([intent.version, intent.cluster]), intent.paymentId, intent.payer.toBytes(), intent.merchant.toBytes(), intent.reservation.toBytes(), u64le(intent.amount), i64le(intent.createdAt), i64le(intent.expiresAt), u32le(intent.sequence), u64le(intent.committedAfter)]);
}

export function intentToPayload(intent: PaymentIntent, signature: Uint8Array): SignedIntentPayload {
  return { v: 1, intent: { version: intent.version, cluster: intent.cluster, payment_id: bytesHex(intent.paymentId), payer: intent.payer.toBase58(), merchant: intent.merchant.toBase58(), reservation: intent.reservation.toBase58(), amount: intent.amount.toString(), created_at: intent.createdAt.toString(), expires_at: intent.expiresAt.toString(), sequence: intent.sequence, committed_after: intent.committedAfter.toString() }, signature: bs58.encode(signature) };
}

export function payloadToIntent(payload: SignedIntentPayload): PaymentIntent {
  const i = payload.intent;
  return buildIntent({ version: i.version, cluster: i.cluster, paymentId: hexBytes(i.payment_id), payer: new PublicKey(i.payer), merchant: new PublicKey(i.merchant), reservation: new PublicKey(i.reservation), amount: BigInt(i.amount), createdAt: BigInt(i.created_at), expiresAt: BigInt(i.expires_at), sequence: i.sequence, committedAfter: BigInt(i.committed_after) });
}

export const bytesHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
function hexBytes(value: string): Uint8Array { if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("payment_id must be 32-byte hex"); return Uint8Array.from(value.match(/../g)!, (x) => parseInt(x, 16)); }
function concat(parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; }

/* Rust golden-vector helper: println!("{}", hex::encode(intent.signing_bytes())); */

export function serializeSettleIntent(intent: PaymentIntent): Uint8Array {
  return new Uint8Array([intent.version, intent.cluster, ...intent.paymentId, ...intent.payer.toBytes(), ...intent.merchant.toBytes(), ...intent.reservation.toBytes(), ...u64le(intent.amount), ...i64le(intent.createdAt), ...i64le(intent.expiresAt), ...u32le(intent.sequence), ...u64le(intent.committedAfter)]);
}
