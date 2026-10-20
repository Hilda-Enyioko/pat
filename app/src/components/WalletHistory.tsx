import type { TimelineKind, WalletHistory as History } from "../lib/chainHistory";
import { lamportsToSol, shortKey } from "../lib/format";
import { CLUSTER } from "../config";

const LABEL: Record<TimelineKind, string> = {
  RESERVED: "Reserved",
  WITHDRAWN: "Withdrawn",
  SENT: "Sent",
  RECEIVED: "Received",
};

const SIGN: Record<TimelineKind, string> = {
  RESERVED: "−",
  WITHDRAWN: "+",
  SENT: "−",
  RECEIVED: "+",
};

export function WalletHistory({
  history,
  loading,
  error,
  online,
  onRefresh,
}: {
  history: History | null;
  loading: boolean;
  error: string | null;
  online: boolean;
  onRefresh: () => void;
}) {
  const items = history?.timeline ?? [];

  return (
    <section className="card ledger-panel">
      <header className="card-header">
        <div className="card-title-group">
          <h3>Wallet history</h3>
          <span className="pill">{!online ? "Cached" : loading ? "Syncing…" : "On-chain"}</span>
        </div>
        <button className="quiet-button refresh-button" onClick={onRefresh} disabled={!online || loading}>
          Refresh
        </button>
      </header>

      {error && <p className="status-message status-error">Sync failed: {error}</p>}
      {!online && <p className="muted">Offline. Showing the last synced history for this wallet.</p>}

      {items.length === 0 ? (
        <p className="muted empty-history">
          {loading ? "Reading the chain…" : "No on-chain activity for this wallet yet."}
        </p>
      ) : (
        <div className="table-scroll-container">
          <table className="ledger-table history-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Counterparty</th>
                <th>Amount</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="mono-cell">{i.at ? new Date(i.at * 1000).toLocaleString() : "—"}</td>
                  <td>
                    <span className={`pill status-${i.kind.toLowerCase()}`}>{LABEL[i.kind]}</span>
                  </td>
                  <td className="mono-cell">{i.counterparty ? shortKey(i.counterparty) : "—"}</td>
                  <td className="mono-cell font-bold">
                    {SIGN[i.kind]}
                    {lamportsToSol(BigInt(i.amount))} SOL
                  </td>
                  <td className="mono-cell">
                    {i.signature ? (
                      <a
                        className="link-accent"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://explorer.solana.com/tx/${i.signature}?cluster=${CLUSTER}`}
                      >
                        {i.signature.slice(0, 6)}…
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
