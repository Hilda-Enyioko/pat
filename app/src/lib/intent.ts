import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { concatBytes, i64le, u32le, u64le } from "./pat";

export interface SignedIntentPayload {
  version: 1;
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

export const INTENT_DOMAIN = new TextEncoder().encode("PAT-INTENT-v1");
export const INTENT_VERSION = 1 as const;
export const DEVNET_CLUSTER = 1;

export function buildIntent(input: Omit<SignedIntentPayload, "version" | "cluster"> & { cluster?: number }): SignedIntentPayload {
  if (input.paymentId.length !== 32) throw new Error("payment_id must be 32 bytes");
  return { ...input, version: 1, cluster: input.cluster ?? DEVNET_CLUSTER };
}

export function serializeIntentSigningBytes(intent: SignedIntentPayload): Uint8Array {
  return concatBytes([
    INTENT_DOMAIN,
    new Uint8Array([intent.version, intent.cluster]),
    intent.paymentId,
    intent.payer.toBytes(), intent.merchant.toBytes(), intent.reservation.toBytes(),
    u64le(intent.amount), i64le(intent.createdAt), i64le(intent.expiresAt),
    u32le(intent.sequence), u64le(intent.committedAfter),
  ]);
}

export function intentToJson(intent: SignedIntentPayload) {
  return {
    version: intent.version, cluster: intent.cluster,
    payment_id: bytesToHex(intent.paymentId), payer: intent.payer.toBase58(),
    merchant: intent.merchant.toBase58(), reservation: intent.reservation.toBase58(),
    amount: intent.amount.toString(), created_at: intent.createdAt.toString(),
    expires_at: intent.expiresAt.toString(), sequence: intent.sequence,
    committed_after: intent.committedAfter.toString(),
  };
}

export function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("payment_id must be 32-byte hex");
  return Uint8Array.from(hex.match(/.{2}/g)!, (x) => Number.parseInt(x, 16));
}
export function intentFromJson(raw: Record<string, unknown>): SignedIntentPayload {
  return buildIntent({
    paymentId: hexToBytes(String(raw.payment_id)), payer: new PublicKey(String(raw.payer)),
    merchant: new PublicKey(String(raw.merchant)), reservation: new PublicKey(String(raw.reservation)),
    amount: BigInt(String(raw.amount)), createdAt: BigInt(String(raw.created_at)),
    expiresAt: BigInt(String(raw.expires_at)), sequence: Number(raw.sequence),
    committedAfter: BigInt(String(raw.committed_after)), cluster: Number(raw.cluster),
  });
}

export function encodeSignedPayload(intent: SignedIntentPayload, signature: Uint8Array) {
  return JSON.stringify({ v: 1, intent: intentToJson(intent), signature: bs58.encode(signature) });
}

/** Rust vector helper: paste the output into TODO_EXPECTED_HEX in intent.test.ts. */
export const RUST_VECTOR_SNIPPET = `println!("{}", hex::encode(intent.signing_bytes()));`;

export function concatIntentBytes(parts: Uint8Array[]) { return concatBytes(parts); }
