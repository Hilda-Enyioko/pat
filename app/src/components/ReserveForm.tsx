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
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [rents, setRents] = useState<{ reservation: bigint; payment: bigint } | null>(null);

  useEffect(() => {
    Promise.all([
      connection.getMinimumBalanceForRentExemption(RESERVATION_SPACE),
      connection.getMinimumBalanceForRentExemption(PAYMENT_SPACE),
    ])
      .then(([r, p]) => setRents({ reservation: BigInt(r), payment: BigInt(p) }))
      .catch(() => setRents(null));
  }, [connection]);

  let total: string | null = null;
  try {
    if (rents) {
      total = lamportsToSol(
        solToLamports(capacitySol) + rents.reservation + rents.payment * BigInt(Number(maxPayments) || 0)
      );
    }
  } catch {
    total = null;
  }

  async function onReserve() {
    if (!publicKey) return;

    const hoursNumber = Number(hours);
    if (!Number.isFinite(hoursNumber) || hoursNumber <= 0) {
      setHoursError("Enter a finite number of hours greater than zero.");
      setStatus("Please fix the highlighted field.");
      return;
    }

    setHoursError(null);
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
      const expiresAt = BigInt(now + Math.round(hoursNumber * 3600));
      const reservationId = BigInt(Date.now());
      const { ix, reservation } = await buildReserveIx({
        owner: publicKey,
        reservationId,
        capacity,
        perPaymentCap,
        expiresAt,
        maxPayments: max,
      });

      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, ...latest }).add(ix);

      setStatus("Simulating…");
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.error("Simulation failed. Detailed logs:\n", sim.value.logs);
        throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
      }

      setStatus("Approve in your wallet…");
      const sig = await sendTransaction(tx, connection);

      setStatus("Confirming…");
      await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");

      const acct = await fetchReservation(connection, reservation);
      if (!acct) throw new Error("Reservation not found after confirmation");

      const clockOffset = now - Math.floor(Date.now() / 1000);
      await initLedgerIfAbsent(reservation.toBase58(), acct, { maxPayments: max, clockOffset });

      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => undefined);

      setStatus(`Reserved ✔  ${sig.slice(0, 12)}…`);
      onCreated();
    } catch (e: any) {
      if (e.logs) {
        console.error("RPC Error Logs:", e.logs);
      }
      console.error(e);
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function requestAirdrop() {
    if (!publicKey) return;
    setStatus("Requesting 1 SOL devnet airdrop…");
    try {
      const signature = await connection.requestAirdrop(publicKey, 1_000_000_000);
      await connection.confirmTransaction(signature, "confirmed");
      setStatus("Airdrop confirmed. Your devnet wallet is funded.");
    } catch (error) {
      console.error(error);
      setStatus("Devnet faucet is rate-limited right now. Try again later or use faucet.solana.com.");
    }
  }

  return (
    <section className="intent-card">
      <h2 style={{ margin: "0 0 10px 0", fontSize: "20px" }}>Reserve (while online)</h2>

      <label>
        Offline capacity (SOL)
        <input
          value={capacitySol}
          onChange={(e) => setCapacitySol(e.target.value)}
          placeholder="1.0"
        />
      </label>

      <label>
        Per-payment cap (SOL)
        <input
          value={capSol}
          onChange={(e) => setCapSol(e.target.value)}
          placeholder="0.5"
        />
      </label>

      <label>
        Spending window (hours)
        <input
          value={hours}
          onChange={(e) => {
            setHours(e.target.value);
            setHoursError(null);
          }}
          aria-invalid={Boolean(hoursError)}
        />
        {hoursError && <span className="field-error">{hoursError}</span>}
      </label>

      <label>
        Max payments (prepays receipt rent)
        <input
          value={maxPayments}
          onChange={(e) => setMaxPayments(e.target.value)}
        />
      </label>

      {total && (
        <p className="muted" style={{ marginTop: "16px" }}>
          Wallet pays about {total} SOL (capacity + rent reserve + account rent) plus ~0.00001 SOL network fee. Unspent funds return on withdraw.
        </p>
      )}

      <button
        className="primary-button full"
        style={{ marginTop: "24px" }}
        onClick={onReserve}
        disabled={!publicKey || busy}
      >
        {busy ? "Working…" : "Reserve funds"}
      </button>

      <div className="devnet-helper">
        <p>Need devnet SOL? <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">Open the Solana faucet</a>.</p>
        <button type="button" onClick={requestAirdrop} disabled={!publicKey || busy}>
          Airdrop 1 SOL (devnet)
        </button>
      </div>

      <p className="muted" style={{ marginTop: "16px" }}>
        Each intent expires within 1 hour and never outlives the spending window.
      </p>

      {!publicKey && <p className="muted">Connect a wallet first.</p>}
      {status && <p className="status-message" style={{ marginTop: "12px" }}>{status}</p>}
    </section>
  );
}
