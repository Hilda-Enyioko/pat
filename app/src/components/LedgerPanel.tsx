import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  availableOffline,
  nowAdjusted,
  pendingTotal,
  phaseOf,
  reconcileWithChain,
  type OfflineLedger,
} from "../lib/ledger";
import { lamportsToSol, shortKey } from "../lib/format";

export function LedgerPanel({
  ledger,
  online,
  onChange,
}: {
  ledger: OfflineLedger;
  online: boolean;
  onChange: () => void;
}) {
  const { connection } = useConnection();
  const [msg, setMsg] = useState<string | null>(null);
  const now = nowAdjusted(ledger);
  const currentPhase = phaseOf(ledger, now);

  async function refresh() {
    try {
      await reconcileWithChain(connection, ledger);
      setMsg("Synced from chain.");
      onChange();
    } catch (e) {
      setMsg(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  useEffect(() => {
    if (online) void refresh();
  }, [online]);

  useEffect(() => {
    if (!online || !ledger.history?.some((h) => h.status === "SIGNED")) return;
    const id = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(id);
  }, [online, ledger.reservation, ledger.history]);

  const historyList = [...(ledger.history ?? [])].sort(
    (a, b) => b.createdAt - a.createdAt
  );

  return (
    <section className="card ledger-panel">
      <header className="card-header">
        <div className="card-title-group">
          <h3>
            Reservation{" "}
            <span className="mono-accent">{shortKey(ledger.reservation)}</span>
          </h3>
          <span className={`pill phase-${currentPhase.toLowerCase()}`}>
            {currentPhase}
          </span>
        </div>

        {!online && (
          <span className="offline-badge">Offline — local ledger</span>
        )}
      </header>

      <div className="balance-display">
        <div className="balance-amount">
          {lamportsToSol(availableOffline(ledger))} <span>SOL</span>
        </div>
        <div className="balance-label">available offline</div>
      </div>

      <div className="ledger-metrics-table-wrapper">
        <table className="ledger-table metrics-table">
          <tbody>
            <tr>
              <td>Capacity</td>
              <td className="align-right mono-accent">
                {lamportsToSol(BigInt(ledger.capacity))} SOL
              </td>
            </tr>
            <tr>
              <td>Committed on-chain</td>
              <td className="align-right mono-accent">
                {lamportsToSol(BigInt(ledger.committedOnChain))} SOL
              </td>
            </tr>
            <tr>
              <td>Pending</td>
              <td className="align-right mono-accent">
                {lamportsToSol(pendingTotal(ledger))} SOL ({ledger.pending.length})
              </td>
            </tr>
            <tr>
              <td>Per-payment cap</td>
              <td className="align-right mono-accent">
                {lamportsToSol(BigInt(ledger.perPaymentCap))} SOL
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="panel-actions">
        <button
          className="quiet-button refresh-button"
          onClick={() => void refresh()}
          disabled={!online}
        >
          Refresh from chain
        </button>
        {msg && (
          <p
            className={`status-message ${
              msg.startsWith("Sync failed") ? "status-error" : "status-success"
            }`}
          >
            {msg}
          </p>
        )}
      </div>

      <div className="history-section">
        <h4>Transaction history</h4>
        {historyList.length === 0 ? (
          <p className="muted empty-history">No local transactions yet.</p>
        ) : (
          <div className="table-scroll-container">
            <table className="ledger-table history-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Merchant</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {historyList.map((h) => (
                  <tr key={h.paymentId}>
                    <td className="mono-cell">
                      {new Date(h.createdAt * 1000).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <td className="mono-cell">
                      {h.merchant ? shortKey(h.merchant) : "—"}
                    </td>
                    <td className="mono-cell font-bold">
                      {lamportsToSol(BigInt(h.amount))} SOL
                    </td>
                    <td>
                      <span className={`pill status-${h.status.toLowerCase()}`}>
                        {h.status}
                      </span>
                      {h.failureReason && (
                        <span className="failure-hint"> — {h.failureReason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
