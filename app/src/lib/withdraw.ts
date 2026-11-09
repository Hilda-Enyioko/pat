import { PublicKey, Transaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { buildWithdrawIx, buildWithdrawTokenIxs, mapProgramError } from "./pat";
import { fetchTokenBalance, getAta } from "./spl";

type Send = (tx: Transaction, connection: Connection) => Promise<string>;

async function simulateAndSend(connection: Connection, owner: PublicKey, ixs: TransactionInstruction[], sendTransaction: Send) {
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, ...latest }).add(...ixs);

  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    const logs = sim.value.logs ?? [];
    console.error("Withdraw simulation failed:\n", logs.join("\n"));
    if (logs.some((l) => l.includes("WithdrawTooEarly"))) throw new Error("The settle window is still open on-chain.");
    throw new Error(mapProgramError(new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`), logs));
  }

  const signature = await sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  return signature;
}

/**
 * Picks the instruction from the reservation: a mint means withdraw_token, otherwise
 * withdraw. Sending withdraw for a token reservation fails with TokenReservation.
 */
export async function withdrawReservation(
  connection: Connection,
  owner: PublicKey,
  reservation: PublicKey,
  sendTransaction: Send,
  mint?: PublicKey | null,
) {
  const ixs = mint ? await buildWithdrawTokenIxs(reservation, owner, mint) : [await buildWithdrawIx(reservation, owner)];
  return simulateAndSend(connection, owner, ixs, sendTransaction);
}

/** What a withdraw returns: lamports (reservation + vault rent) and, for token reservations, vault tokens. */
export async function refundPreview(connection: Connection, reservation: PublicKey, mint?: PublicKey | null) {
  const lamports = BigInt(await connection.getBalance(reservation, "confirmed"));
  if (!mint) return { lamports, tokens: null as bigint | null };
  const vault = getAta(mint, reservation, true);
  const [vaultLamports, tokens] = await Promise.all([connection.getBalance(vault, "confirmed"), fetchTokenBalance(connection, vault)]);
  return { lamports: lamports + BigInt(vaultLamports), tokens: tokens ?? 0n };
}
