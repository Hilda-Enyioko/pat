// Parity between the hand-built instructions and the Anchor IDL the program was built with.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { buildReserveDelegatedIx, buildWithdrawTokenIxs, decodeReservation, findReservationPda, RESERVATION_SPACE, PAYMENT_SPACE } from "../lib/pat";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAta } from "../lib/spl";
import { PROGRAM_ID } from "../config";

type IdlIx = { name: string; discriminator: number[]; accounts: { name: string; writable?: boolean; signer?: boolean }[]; args: { name: string; type: string }[] };
const idl = JSON.parse(readFileSync(new URL("../../../gateway/idl/pat.json", import.meta.url), "utf8")) as { address: string; instructions: IdlIx[] };
const ix = (name: string) => idl.instructions.find((i) => i.name === name)!;

// Minimal borsh encoder for the IDL's primitive arg types.
function encodeArgs(def: IdlIx, values: Record<string, bigint | number | PublicKey>): Buffer {
  const parts = def.args.map(({ name, type }) => {
    const v = values[name];
    const b = Buffer.alloc(type === "pubkey" ? 32 : type === "u32" ? 4 : 8);
    if (type === "u64") b.writeBigUInt64LE(BigInt(v as bigint));
    else if (type === "i64") b.writeBigInt64LE(BigInt(v as bigint));
    else if (type === "u32") b.writeUInt32LE(Number(v));
    else if (type === "pubkey") (v as PublicKey).toBuffer().copy(b);
    else throw new Error(`unhandled type ${type}`);
    return b;
  });
  return Buffer.concat([Buffer.from(def.discriminator), ...parts]);
}

const flags = (def: IdlIx) => def.accounts.map((a) => [Boolean(a.writable), Boolean(a.signer)]);

describe("program id", () => {
  it("matches the IDL", () => expect(PROGRAM_ID.toBase58()).toBe(idl.address));
});

describe("reserve_delegated", () => {
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const delegate = Keypair.generate().publicKey;
  const args = { reservation_id: 1794257233471n, capacity: 20_000_000n, per_payment_cap: 10_000_000n, expires_at: 1794257411n, max_payments: 20, delegate };

  it("encodes data byte-for-byte like Anchor", async () => {
    const { ix: built } = await buildReserveDelegatedIx({
      owner, mint, delegate, reservationId: args.reservation_id, capacity: args.capacity,
      perPaymentCap: args.per_payment_cap, expiresAt: args.expires_at, maxPayments: args.max_payments,
    });
    expect(Buffer.from(built.data).equals(encodeArgs(ix("reserve_delegated"), args))).toBe(true);
    const disc = createHash("sha256").update("global:reserve_delegated").digest().subarray(0, 8);
    expect(Buffer.from(built.data.subarray(0, 8)).equals(disc)).toBe(true);
  });

  it("lists accounts in IDL order with IDL flags", async () => {
    const { ix: built, reservation, vault, ownerTokenAccount } = await buildReserveDelegatedIx({
      owner, mint, delegate, reservationId: 7n, capacity: 1n, perPaymentCap: 1n, expiresAt: 1n, maxPayments: 1,
    });
    expect(built.keys.map((k) => [k.isWritable, k.isSigner])).toEqual(flags(ix("reserve_delegated")));
    expect(built.keys.map((k) => k.pubkey.toBase58())).toEqual(
      [owner, findReservationPda(owner, 7n)[0], mint, getAta(mint, owner), getAta(mint, reservation, true), TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId].map((k) => k.toBase58()),
    );
    expect(reservation.equals(findReservationPda(owner, 7n)[0])).toBe(true);
    expect(vault.equals(getAta(mint, reservation, true))).toBe(true);
    expect(ownerTokenAccount.equals(getAta(mint, owner))).toBe(true);
  });
});

describe("withdraw_token", () => {
  it("is discriminator-only data, IDL account order, after an idempotent ATA create", async () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const [reservation] = findReservationPda(owner, 9n);
    const [createAta, withdraw] = await buildWithdrawTokenIxs(reservation, owner, mint);
    expect(createAta.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(Array.from(createAta.data)).toEqual([1]);
    expect(Array.from(withdraw.data)).toEqual(ix("withdraw_token").discriminator);
    expect(withdraw.keys.map((k) => [k.isWritable, k.isSigner])).toEqual(flags(ix("withdraw_token")));
    expect(withdraw.keys.map((k) => k.pubkey.toBase58())).toEqual(
      [owner, reservation, mint, getAta(mint, reservation, true), getAta(mint, owner), TOKEN_PROGRAM_ID].map((k) => k.toBase58()),
    );
  });
});

describe("decodeReservation", () => {
  function encode(delegate: PublicKey | null, mint: PublicKey | null) {
    const b = Buffer.alloc(RESERVATION_SPACE);
    let o = 8;
    const owner = Keypair.generate().publicKey;
    owner.toBuffer().copy(b, o); o += 32;
    for (const v of [5n, 100n, 30n, 999n, 50n]) { b.writeBigUInt64LE(v, o); o += 8; }
    b.writeUInt32LE(2, o); o += 4;
    for (const v of [10n, 20n, 1820n]) { b.writeBigInt64LE(v, o); o += 8; }
    for (const k of [delegate, mint]) {
      if (k) { b[o] = 1; k.toBuffer().copy(b, o + 1); o += 33; } else { b[o] = 0; o += 1; }
    }
    b[o] = 254;
    return { b, owner };
  }

  it("reads a SOL (QR) reservation: None, None", () => {
    const { b, owner } = encode(null, null);
    const r = decodeReservation(b);
    expect(r.owner.equals(owner)).toBe(true);
    expect([r.capacity, r.committed, r.perPaymentCap, r.paymentsSettled, r.settleDeadline]).toEqual([100n, 30n, 50n, 2, 1820n]);
    expect(r.delegate).toBeNull();
    expect(r.mint).toBeNull();
    expect(r.bump).toBe(254);
  });

  it("reads a token (USSD) reservation: Some, Some", () => {
    const d = Keypair.generate().publicKey;
    const m = Keypair.generate().publicKey;
    const r = decodeReservation(encode(d, m).b);
    expect(r.delegate?.equals(d)).toBe(true);
    expect(r.mint?.equals(m)).toBe(true);
    expect(r.bump).toBe(254);
  });

  it("uses the deployed account sizes", () => {
    expect(RESERVATION_SPACE).toBe(175);
    expect(PAYMENT_SPACE).toBe(208);
  });
});
