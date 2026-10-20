import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Vault } from "lucide-react";
import * as PricingCard from "@/components/ui/pricing-card";
import { cn } from "@/lib/utils";
import {
  availableOffline,
  isLocked,
  isReleasable,
  nowAdjusted,
  pendingTotal,
  phaseOf,
  reconcileWithChain,
  releasesIn,
  type HistoryStatus,
  type OfflineLedger,
  type Phase,
} from "../lib/ledger";
import { chainNow } from "../lib/pat";
import { withdrawReservation } from "../lib/withdraw";
import { lamportsToSol, shortKey } from "../lib/format";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";

type WithdrawStage = "idle" | "checking" | "confirm" | "working";

const phaseTile: Record<Phase | "Withdrawn", string> = {
  Active: "bg-blue",
  Expiring: "bg-yellow",
  Releasable: "bg-red",
  Withdrawn: "bg-stone",
};

const statusPill: Record<HistoryStatus, string> = {
  SIGNED: "bg-yellow",
  SETTLED: "bg-blue",
  EXPIRED: "bg-stone",
  FAILED: "bg-red/25",
};

const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

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

  const balance = ledger.withdrawn ? 0n : locked ? unspentOnChain : availableOffline(ledger);
  const balanceLabel = locked ? "SOL unspent on-chain (signing disabled here)" : "SOL available offline";

  const metrics = [
    ["Capacity", `${lamportsToSol(BigInt(ledger.capacity))} SOL`],
    ["Committed on-chain", `${lamportsToSol(BigInt(ledger.committedOnChain))} SOL`],
    ["Pending", `${lamportsToSol(pendingTotal(ledger))} SOL (${ledger.pending.length})`],
    ["Per-payment cap", `${lamportsToSol(BigInt(ledger.perPaymentCap))} SOL`],
  ];

  return (
    <PricingCard.Card className="max-w-none rounded-[22px] bg-white p-1.5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)]">
      <PricingCard.Header className={cn("grainy mb-2 rounded-[18px] border-0 p-5", phaseTile[phaseLabel])} glassEffect={false}>
        <PricingCard.Plan className="mb-10 gap-3">
          <PricingCard.PlanName className="min-w-0 text-ink">
            <Vault />
            <span className="truncate">
              Reservation <span className="font-mono">{shortKey(ledger.reservation)}</span>
            </span>
          </PricingCard.PlanName>
          <PricingCard.Badge className="shrink-0 border-ink/25 bg-white/55 font-semibold text-ink">{phaseLabel}</PricingCard.Badge>
        </PricingCard.Plan>
        <PricingCard.Price className="flex-wrap gap-x-3">
          <PricingCard.MainPrice className="font-display text-[clamp(52px,6vw,76px)] font-black leading-[0.85] tracking-[-0.05em] [font-stretch:85%]">
            {lamportsToSol(balance)}
          </PricingCard.MainPrice>
          <PricingCard.Period className="text-ink/75">{balanceLabel}</PricingCard.Period>
        </PricingCard.Price>
        <PricingCard.Description className="text-ink/70">
          {ledger.withdrawn
            ? "Closed and refunded to your wallet."
            : `Spend until ${when(ledger.expiresAt)} · settle by ${when(ledger.settleDeadline)}`}
        </PricingCard.Description>
      </PricingCard.Header>

      <PricingCard.Body className="space-y-5">
        {locked && (
          <StatusNote tone="warning">
            Restored from chain. Payments signed on another device or before storage was cleared cannot be seen, so
            signing is disabled for this reservation here. Reserve on this device to spend offline, or withdraw once the
            settle window closes.
          </StatusNote>
        )}

        <dl className="m-0 grid grid-cols-2 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-[14px] bg-paper px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="m-0 mt-1 font-mono text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        {(stage === "confirm" || stage === "working") && (
          <div className="grainy on-dark space-y-4 rounded-[18px] bg-card-dark p-5 text-white">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-white/60">Withdraw returns</p>
            <p className="m-0 font-display text-5xl font-black leading-[0.85] tracking-[-0.05em] [font-stretch:85%]">
              {lamportsToSol(refund)} <span className="text-xl tracking-normal">SOL</span>
            </p>
            <p className="m-0 text-sm leading-relaxed text-white/70">
              Closes this reservation and returns unspent capacity, unused receipt rent and the reservation account rent
              to your wallet.
            </p>
            {unsettled > 0 && (
              <p className="m-0 text-sm text-yellow">
                {unsettled} signed payment{unsettled === 1 ? " was" : "s were"} not settled in time and can no longer be
                paid.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <PillButton
                tone="red"
                text={stage === "working" ? "Withdrawing…" : "Confirm withdraw"}
                onClick={() => void confirmWithdraw()}
                disabled={stage === "working"}
              />
              <PillButton tone="light" text="Cancel" onClick={() => setStage("idle")} disabled={stage === "working"} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <PillButton size="sm" tone="light" text="Refresh from chain" onClick={() => void refresh()} disabled={!online} />
          {!ledger.withdrawn && releasable && isOwner && stage === "idle" && (
            <PillButton
              size="sm"
              text="Withdraw"
              onClick={() => void prepareWithdraw()}
              disabled={!online}
              title={online ? undefined : "Go online to withdraw"}
            />
          )}
          {stage === "checking" && <PillButton size="sm" tone="light" text="Checking…" disabled />}
          {!ledger.withdrawn && !releasable && (
            <span className="text-sm text-muted-foreground">Withdraw opens in {formatDuration(releasesIn(ledger, now))}</span>
          )}
          {!online && <span className="text-sm text-muted-foreground">Offline: showing the local ledger</span>}
        </div>
        {msg && <StatusNote tone={isErrorMsg ? "error" : "success"}>{msg}</StatusNote>}

        <PricingCard.Separator>Transaction history</PricingCard.Separator>

        {historyList.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No local transactions yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {historyList.map((h) => (
              <li key={h.paymentId} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-[14px] border border-ink/8 px-4 py-3">
                <span className="font-mono text-sm font-semibold">{lamportsToSol(BigInt(h.amount))} SOL</span>
                <span className={cn("justify-self-end rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide", statusPill[h.status])}>
                  {h.status}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(h.createdAt * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · to{" "}
                  {h.merchant ? shortKey(h.merchant) : "—"}
                </span>
                {(h.failureReason || h.status === "EXPIRED") && (
                  <span className="justify-self-end text-xs text-red">{h.failureReason ?? "settle window closed"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PricingCard.Body>
    </PricingCard.Card>
  );
}
