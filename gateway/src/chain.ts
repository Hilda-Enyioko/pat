import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import fs from "fs";
import {
  Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { config } from "./config";

export const connection = new Connection(config.rpcUrl, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(config.keeper), {
  commitment: "confirmed",
});
export const idl = JSON.parse(fs.readFileSync(config.idlPath, "utf8"));
export const program: any = new anchor.Program(idl, provider);

const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export const merchantPda = (code: number) =>
  PublicKey.findProgramAddressSync([Buffer.from("merchant"), u32le(code)], program.programId)[0];
export const paymentPda = (reservation: PublicKey, id: Buffer) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), reservation.toBuffer(), id], program.programId)[0];

export async function readReservation(key: PublicKey) {
  const r = await program.account.reservation.fetchNullable(key, "confirmed");
  if (!r) return null;
  return {
    owner: new PublicKey(r.owner),
    capacity: BigInt(r.capacity.toString()),
    committed: BigInt(r.committed.toString()),
    perPaymentCap: BigInt(r.perPaymentCap.toString()),
    expiresAt: r.expiresAt.toNumber() as number,
    delegate: r.delegate ? new PublicKey(r.delegate) : null,
    mint: r.mint ? new PublicKey(r.mint) : null,
  };
}

export async function merchantPayout(code: number): Promise<PublicKey | null> {
  const m = await program.account.merchant.fetchNullable(merchantPda(code));
  return m ? (m.payout as PublicKey) : null;
}

export async function paymentExists(reservation: PublicKey, id: Buffer) {
  return (await connection.getAccountInfo(paymentPda(reservation, id))) !== null;
}

export async function settleDelegated(p: {
  reservation: PublicKey; mint: PublicKey; paymentId: Buffer;
  merchantCode: number; amount: bigint;
}): Promise<string> {
  const payout = await merchantPayout(p.merchantCode);
  if (!payout) throw new Error("Error Code: AccountNotInitialized");

  const keeper = config.keeper.publicKey;
  const vault = getAssociatedTokenAddressSync(p.mint, p.reservation, true);
  const merchantAta = getAssociatedTokenAddressSync(p.mint, payout, true);

  const settleIx = await program.methods
    .settleDelegated(Array.from(p.paymentId), new BN(p.amount.toString()))
    .accountsPartial({
      delegate: keeper,
      reservation: p.reservation,
      merchantEntry: merchantPda(p.merchantCode),
      mint: p.mint,
      vault,
      merchantTokenAccount: merchantAta,
      payment: paymentPda(p.reservation, p.paymentId),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  // Idempotent: creates the merchant's token account only if it doesn't exist yet.
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(keeper, merchantAta, payout, p.mint),
    settleIx
  );
  return sendAndConfirmTransaction(connection, tx, [config.keeper], { commitment: "confirmed" });
}

export type MappedError = {
  alreadySettled: boolean; retriable: boolean; userMessage: string; raw: string;
};

export function mapError(e: any): MappedError {
  const logs = [...(e?.logs ?? []), ...(e?.transactionLogs ?? [])].join("\n");
  const raw = `${e?.message ?? e}\n${logs}`;
  const code = /Error Code: (\w+)/.exec(raw)?.[1];
  const base = { raw, alreadySettled: false, retriable: false };
  if (/already in use/.test(raw)) return { ...base, alreadySettled: true, userMessage: "" };
  switch (code) {
    case "ExceedsPerPaymentCap": return { ...base, userMessage: "Amount is above your per-payment limit." };
    case "InsufficientCapacity": return { ...base, userMessage: "Not enough reserved balance." };
    case "ReservationExpired": return { ...base, userMessage: "Your reservation has expired." };
    case "RentReserveExhausted": return { ...base, userMessage: "Payment count limit reached for this reservation." };
    case "AccountNotInitialized": return { ...base, userMessage: "Unknown merchant." };
    case "MerchantMismatch": return { ...base, userMessage: "Merchant payout details changed. Contact support." };
    case "ZeroAmount": return { ...base, userMessage: "Amount must be greater than zero." };
    case "NotDelegate":
    case "ReservationNotDelegated":
      return { ...base, userMessage: "This reservation is not enabled for USSD. Contact support." };
    case undefined: break;
    default: return { ...base, userMessage: "Payment could not be completed. Contact support." };
  }
  const transient = /blockhash|timeout|timed out|429|fetch failed|ECONN|node is behind/i.test(raw);
  return { ...base, retriable: transient, userMessage: "Network problem. Please try again." };
}
