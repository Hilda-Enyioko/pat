// The few SPL Token pieces PAT needs, without pulling in @solana/spl-token.
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction, type Connection } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const MINT_LEN = 82;
const TOKEN_ACCOUNT_LEN = 165;
export const TOKEN_ACCOUNT_SPACE = TOKEN_ACCOUNT_LEN;

/** Associated token account. `allowOwnerOffCurve` is needed when the owner is a PDA (the vault). */
export function getAta(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) throw new Error("Token owner is off curve");
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/** Associated Token Program `CreateIdempotent` (instruction 1): no-op if the account exists. */
export function createAtaIdempotentIx(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export type MintInfo =
  | { ok: true; decimals: number }
  | { ok: false; reason: "missing" | "token2022" | "notMint" };

export async function fetchMintInfo(c: Connection, mint: PublicKey): Promise<MintInfo> {
  const info = await c.getAccountInfo(mint, "confirmed");
  if (!info) return { ok: false, reason: "missing" };
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return { ok: false, reason: "token2022" };
  if (!info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length !== MINT_LEN) return { ok: false, reason: "notMint" };
  // Mint layout: mint_authority COption<Pubkey> (36), supply u64 (8), decimals u8 at offset 44.
  return { ok: true, decimals: info.data[44] };
}

/** Token amount held by a classic SPL token account, or null if it does not exist. */
export async function fetchTokenBalance(c: Connection, account: PublicKey): Promise<bigint | null> {
  const info = await c.getAccountInfo(account, "confirmed");
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length < TOKEN_ACCOUNT_LEN) return null;
  // Token account layout: mint (32), owner (32), amount u64 at offset 64.
  return new DataView(info.data.buffer, info.data.byteOffset).getBigUint64(64, true);
}
