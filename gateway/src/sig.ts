import { createPublicKey, verify } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";

// Raw 32-byte ed25519 key -> SPKI DER, so node's crypto can verify without extra deps.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verifies a base58 wallet signature (signMessage) over a UTF-8 message. */
export function verifyWalletSignature(message: string, signatureB58: string, signer: PublicKey): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(utils.bytes.bs58.decode(signatureB58));
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, signer.toBuffer()]), format: "der", type: "spki" });
  return verify(null, Buffer.from(message, "utf8"), key, sig);
}

/** Simple in-memory sliding-window limiter. Fine for the single gateway instance. */
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    return list.length > max;
  };
}
