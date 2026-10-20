import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { buildWithdrawIx } from "./pat";

export async function withdrawReservation(
  connection: Connection,
  owner: PublicKey,
  reservation: PublicKey,
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>
) {
  const ix = await buildWithdrawIx(reservation, owner);
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, ...latest }).add(ix);

  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    const logs = sim.value.logs?.join("\n") ?? "";
    console.error("Withdraw simulation failed:\n", logs);
    if (logs.includes("WithdrawTooEarly")) {
      throw new Error("The settle window is still open on-chain.");
    }
    if (logs.includes("NotReservationOwner")) {
      throw new Error("Only the wallet that created this reservation can withdraw it.");
    }
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  }

  const signature = await sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  return signature;
}
