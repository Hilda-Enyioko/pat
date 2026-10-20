import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  availableOffline,
  isLocked,
  isReleasable,
  nowAdjusted,
  pendingTotal,
  phaseOf,
  reconcileWithChain,
  releasesIn,
  type OfflineLedger,
} from "../lib/ledger";
import { chainNow } from "../lib/pat";
import { withdrawReservation } from "../lib/withdraw";
import { lamportsToSol, shortKey } from "../lib/format";

type WithdrawStage = "idle" | "checking" | "confirm" | "working";

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

export function LedgerPanel({
  ledger,
  online,
  onChange,
  onWithdrawn,
}: {
  ledger: OfflineLedger;
  online: boolean;
  onChange: () => void;
  onWithdrawn: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  const [stage, setStage] = useState<WithdrawStage>("idle");
  const [refund, setRefund] = useState<bigint>(0n);
  const [unsettled, setUnsettled] = useState(0);
  const [, setTick] = useState(0);

  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const now = nowAdjusted(ledger);
  const phaseLabel = ledger.withdrawn ? "Withdrawn" : phaseOf(ledger, now);
  const locked = isLocked(ledger);
  const releasable = isReleasable(ledger, now);
  const hasSigned = ledger.history?.some((h) => h.status === "SIGNED") ?? false;
  const isOwner = publicKey?.toBase58() === ledger.owner;
  const unspentOnChain = BigInt(ledger.capacity) - BigInt(ledger.committedOnChain);

  const refresh = useCallback(
    async (silent = false) => {
      try {
        await reconcileWithChain(connection, ledgerRef.current);
        if (!silent) setMsg("Synced from chain.");
        onChangeRef.current();
      } catch (e) {
        setMsg(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [connection]
  );

  useEffect(() => {
    if (online) void refresh(true);
  }, [online, refresh]);

  useEffect(() => {
    if (!online || !hasSigned || ledger.withdrawn) return;
    const id = window.setInterval(() => void refresh(true), 15000);
    return () => window.clearInterval(id);
  }, [online, hasSigned, ledger.withdrawn, ledger.reservation, refresh]);

  useEffect(() => {
    if (ledger.withdrawn || releasable) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 30000);
    return () => window.clearInterval(id);
  }, [ledger.withdrawn, releasable]);

  async function prepareWithdraw() {
    setMsg(null);
    setStage("checking");
    try {
      const chainTime = await chainNow(connection);
      if (chainTime <= ledger.settleDeadline) {
        throw new Error(`The settle window is still open. Opens in ${formatDuration(ledger.settleDeadline + 1 - chainTime)}.`);
      }
      const fresh = await reconcileWithChain(connection, ledger);
      if (fresh.withdrawn) {
        onChangeRef.current();
        setStage("idle");
        setMsg("Already withdrawn.");
        return;
      }
      const lamports = await connection.getBalance(new PublicKey(ledger.reservation), "confirmed");
      setRefund(BigInt(lamports));
      setUnsettled(fresh.history.filter((h) => h.status === "EXPIRED" || h.status === "SIGNED").length);
      setStage("confirm");
    } catch (e) {
      setStage("idle");
      setMsg(`Withdraw failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function confirmWithdraw() {
    if (!publicKey || !sendTransaction) {
      setMsg("Withdraw failed: connect the wallet that created this reservation.");
      return;
    }
    setStage("working");
    try {
      const signature = await withdrawReservation(
        connection,
        publicKey,
        new PublicKey(ledger.reservation),
        sendTransaction
      );
      await reconcileWithChain(connection, ledgerRef.current).catch(() => undefined);
      setMsg(`Withdrawn ✔  ${signature.slice(0, 12)}…`);
      setStage("idle");
      onWithdrawn();
    } catch (e) {
      setStage("confirm");
      setMsg(`Withdraw failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const historyList = [...(ledger.history ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const isErrorMsg = msg?.startsWith("Sync failed") || msg?.startsWith("Withdraw failed");

  return (
    <section className="card ledger-panel">
      <header className="card-header">
        <div className="card-title-group">
          <h3>
            Reservation <span className="mono-accent">{shortKey(ledger.reservation)}</span>
          </h3>
          <span className={`pill phase-${phaseLabel.toLowerCase()}`}>{phaseLabel}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!online && <span className="offline-badge">Offline — local ledger</span>}

          {!ledger.withdrawn && releasable && isOwner && stage === "idle" && (
            <button
              type="button"
              className="primary-button"
              onClick={() => void prepareWithdraw()}
              disabled={!online}
              title={online ? undefined : "Go online to withdraw"}
            >
              Withdraw
            </button>
          )}
          {stage === "checking" && (
            <button type="button" className="quiet-button" disabled>
              Checking…
            </button>
          )}
          {!ledger.withdrawn && !releasable && (
            <span className="muted">Withdraw opens in {formatDuration(releasesIn(ledger, now))}</span>
          )}
        </div>
      </header>

      {locked && (
        <p className="status-message status-warning">
          Restored from chain. Payments signed on another device or before storage was cleared cannot
          be seen, so signing is disabled for this reservation here. Reserve on this device to spend
          offline, or withdraw once the settle window closes.
        </p>
      )}

      {(stage === "confirm" || stage === "working") && (
        <div className="summary-banner">
          <p>
            Withdrawing closes this reservation and returns{" "}
            <strong className="mono-accent">{lamportsToSol(refund)} SOL</strong> to your wallet: unspent
            capacity, unused receipt rent and the reservation account rent.
          </p>
          {unsettled > 0 && (
            <p className="muted">
              {unsettled} signed payment{unsettled === 1 ? " was" : "s were"} not settled in time and can
              no longer be paid.
            </p>
          )}
          <div className="action-row">
            <button
              type="button"
              className="primary-button"
              onClick={() => void confirmWithdraw()}
              disabled={stage === "working"}
            >
              {stage === "working" ? "Withdrawing…" : "Confirm withdraw"}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setStage("idle")}
              disabled={stage === "working"}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="balance-display">
        <div className="balance-amount">
          {lamportsToSol(locked || ledger.withdrawn ? (ledger.withdrawn ? 0n : unspentOnChain) : availableOffline(ledger))}{" "}
          <span>SOL</span>
        </div>
        <div className="balance-label">
          {ledger.withdrawn
            ? "available offline"
            : locked
            ? "unspent on-chain (signing disabled here)"
            : "available offline"}
        </div>
      </div>

      <div className="ledger-metrics-table-wrapper">
        <table className="ledger-table metrics-table">
          <tbody>
            <tr>
              <td>Capacity</td>
              <td className="align-right mono-accent">{lamportsToSol(BigInt(ledger.capacity))} SOL</td>
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
        <button className="quiet-button refresh-button" onClick={() => void refresh()} disabled={!online}>
          Refresh from chain
        </button>
        {msg && (
          <p className={`status-message ${isErrorMsg ? "status-error" : "status-success"}`}>{msg}</p>
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
                    <td className="mono-cell">{new Date(h.createdAt * 1000).toLocaleString()}</td>
                    <td className="mono-cell">{h.merchant ? shortKey(h.merchant) : "—"}</td>
                    <td className="mono-cell font-bold">{lamportsToSol(BigInt(h.amount))} SOL</td>
                    <td>
                      <span className={`pill status-${h.status.toLowerCase()}`}>{h.status}</span>
                      {h.failureReason && <span className="failure-hint"> — {h.failureReason}</span>}
                      {h.status === "EXPIRED" && !h.failureReason && (
                        <span className="failure-hint"> — settle window closed</span>
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
