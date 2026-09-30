import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";

const GOLDEN = "<paste GOLDEN_INTENT_HEX here>";

function intentSigningBytes(i: {
  version: number; cluster: number; paymentId: Uint8Array;
  payer: PublicKey; merchant: PublicKey; reservation: PublicKey;
  amount: bigint; createdAt: bigint; expiresAt: bigint;
  sequence: number; committedAfter: bigint;
}): Buffer {
  const b = Buffer.alloc(179);
  let o = 0;
  o += b.write("PAT-INTENT-v1", o, "ascii");
  b.writeUInt8(i.version, o); o += 1;
  b.writeUInt8(i.cluster, o); o += 1;
  Buffer.from(i.paymentId).copy(b, o); o += 32;
  i.payer.toBuffer().copy(b, o); o += 32;
  i.merchant.toBuffer().copy(b, o); o += 32;
  i.reservation.toBuffer().copy(b, o); o += 32;
  b.writeBigUInt64LE(i.amount, o); o += 8;
  b.writeBigInt64LE(i.createdAt, o); o += 8;
  b.writeBigInt64LE(i.expiresAt, o); o += 8;
  b.writeUInt32LE(i.sequence, o); o += 4;
  b.writeBigUInt64LE(i.committedAfter, o); o += 8;
  return b;
}

describe("PaymentIntent encoding", () => {
  it("matches the Rust golden vector", () => {
    const bytes = intentSigningBytes({
      version: 1, cluster: 1,
      paymentId: new Uint8Array(32).fill(1),
      payer: new PublicKey(new Uint8Array(32).fill(2)),
      merchant: new PublicKey(new Uint8Array(32).fill(3)),
      reservation: new PublicKey(new Uint8Array(32).fill(4)),
      amount: 250_000_000n, createdAt: 1_700_000_000n, expiresAt: 1_700_003_600n,
      sequence: 5, committedAfter: 750_000_000n,
    });
    expect(bytes.toString("hex")).to.equal(GOLDEN);
  });
});
