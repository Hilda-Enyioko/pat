import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  availableOffline, debitForPayment, deleteLedger, pendingTotal, phaseOf,
  randomPaymentIdHex, refreshCommitted, LedgerError, type OfflineLedger,
} from "../lib/ledger";
import { fetchReservation } from "../lib/pat";
import { lamportsToSol, shortKey } from "../lib/format";

export function LedgerPanel({ ledger, online, onChange }: { ledger: OfflineLedger; online: boolean; onChange: () => void }) {
  const { connection } = useConnection();
  const [msg, setMsg] = useState<string | null>(null);
  const now = Math.floor(Date.now() / 1000);

  async function refresh() {
    try {
      const acct = await fetchReservation(connection, new PublicKey(ledger.reservation));
      if (!acct) { setMsg("Reservation no longer exists on-chain (withdrawn)."); return; }
      await refreshCommitted(ledger.reservation, acct);
      setMsg("Synced from chain.");
      onChange();
    } catch (e) { setMsg(`Sync failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async function devDebit() {
    try {
      await debitForPayment(ledger.reservation, { paymentId: randomPaymentIdHex(), amount: 10_000_000n }, now);
      setMsg("Simulated 0.01 SOL debit.");
    } catch (e) { setMsg(e instanceof LedgerError ? `Blocked: ${e.code}` : String(e)); }
    onChange();
  }

  async function devClear() {
    if (!confirm("DEV ONLY: delete this local ledger, including any pending intents?")) return;
    await deleteLedger(ledger.reservation);
    onChange();
  }

  return (
    <section className="card">
      <h3>Reservation {shortKey(ledger.reservation)} <span className={`pill ${phaseOf(ledger, now)}`}>{phaseOf(ledger, now)}</span></h3>
      <div className="big">{lamportsToSol(availableOffline(ledger))} SOL <small>available offline</small></div>
      <table>
        <tbody>
          <tr><td>Capacity</td><td>{lamportsToSol(BigInt(ledger.capacity))} SOL</td></tr>
          <tr><td>Committed on-chain</td><td>{lamportsToSol(BigInt(ledger.committedOnChain))} SOL</td></tr>
          <tr><td>Pending (signed, unsettled)</td><td>{lamportsToSol(pendingTotal(ledger))} SOL ({ledger.pending.length})</td></tr>
          <tr><td>Per-payment cap</td><td>{lamportsToSol(BigInt(ledger.perPaymentCap))} SOL</td></tr>
          <tr><td>Spending window ends</td><td>{new Date(ledger.expiresAt * 1000).toLocaleString()}</td></tr>
          <tr><td>Settle deadline</td><td>{new Date(ledger.settleDeadline * 1000).toLocaleString()}</td></tr>
        </tbody>
      </table>
      <div className="row">
        <button onClick={refresh} disabled={!online}>Refresh from chain</button>
        <button className="dev" onClick={devDebit}>dev: debit 0.01</button>
        <button className="dev" onClick={devClear}>dev: clear</button>
      </div>
      {msg && <p className="status">{msg}</p>}
    </section>
  );
}
