import { useEffect, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { buildReserveIx, chainNow, fetchReservation, PAYMENT_SPACE, RESERVATION_SPACE } from "../lib/pat";
import { initLedgerIfAbsent } from "../lib/ledger";
import { lamportsToSol, solToLamports } from "../lib/format";

export function ReserveForm({ onCreated }: { onCreated: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [capacitySol, setCapacitySol] = useState("1");
  const [capSol, setCapSol] = useState("0.5");
  const [hours, setHours] = useState("24");
  const [maxPayments, setMaxPayments] = useState("20");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [rents, setRents] = useState<{ reservation: bigint; payment: bigint } | null>(null);

  useEffect(() => {
    Promise.all([
      connection.getMinimumBalanceForRentExemption(RESERVATION_SPACE),
      connection.getMinimumBalanceForRentExemption(PAYMENT_SPACE),
    ]).then(([r, p]) => setRents({ reservation: BigInt(r), payment: BigInt(p) })).catch(() => setRents(null));
  }, [connection]);

  let total: string | null = null;
  try {
    if (rents) {
      total = lamportsToSol(
        solToLamports(capacitySol) + rents.reservation + rents.payment * BigInt(Number(maxPayments) || 0),
      );
    }
  } catch { /* invalid input; leave blank */ }

  async function onReserve() {
    if (!publicKey) return;
    setBusy(true);
    setStatus("Preparing…");
    try {
      const capacity = solToLamports(capacitySol);
      const perPaymentCap = solToLamports(capSol);
      const max = Number(maxPayments);
      if (capacity <= 0n || perPaymentCap <= 0n) throw new Error("Amounts must be greater than zero");
      if (perPaymentCap > capacity) throw new Error("Per-payment cap cannot exceed capacity");
      if (!Number.isInteger(max) || max <= 0) throw new Error("Max payments must be a positive whole number");

      const now = await chainNow(connection);
      const expiresAt = BigInt(now + Math.round(Number(hours) * 3600));
      const reservationId = BigInt(Date.now()); // unique per owner; never reuse an id
      const { ix, reservation } = await buildReserveIx({
        owner: publicKey, reservationId, capacity, perPaymentCap, expiresAt, maxPayments: max,
      });

      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, ...latest }).add(ix);
      setStatus("Approve in your wallet…");
      const sig = await sendTransaction(tx, connection);
      setStatus("Confirming…");
      await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");

      // Initialize the offline ledger from the on-chain account (authoritative values).
      const acct = await fetchReservation(connection, reservation);
      if (!acct) throw new Error("Reservation not found after confirmation");
      await initLedgerIfAbsent(reservation.toBase58(), acct);
      setStatus(`Reserved ✔  ${sig.slice(0, 12)}…`);
      onCreated();
    } catch (e) {
      console.error(e);
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>1. Reserve (while online)</h2>
      <label>Offline capacity (SOL)<input value={capacitySol} onChange={(e) => setCapacitySol(e.target.value)} /></label>
      <label>Per-payment cap (SOL)<input value={capSol} onChange={(e) => setCapSol(e.target.value)} /></label>
      <label>Spending window (hours)<input value={hours} onChange={(e) => setHours(e.target.value)} /></label>
      <label>Max payments (prepays receipt rent)<input value={maxPayments} onChange={(e) => setMaxPayments(e.target.value)} /></label>
      {total && <p className="muted">Wallet pays about {total} SOL (capacity + rent reserve + account rent) plus the network fee. Unspent funds return on withdraw.</p>}
      <button onClick={onReserve} disabled={!publicKey || busy}>{busy ? "Working…" : "Reserve funds"}</button>
      {!publicKey && <p className="muted">Connect a wallet first.</p>}
      {status && <p className="status">{status}</p>}
    </section>
  );
}
