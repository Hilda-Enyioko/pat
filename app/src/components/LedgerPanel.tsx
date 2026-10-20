import { useEffect, useEffectEvent, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Vault } from "lucide-react";
import * as PricingCard from "@/components/ui/pricing-card";
import { cn } from "@/lib/utils";
import {
  availableOffline,
  nowAdjusted,
  pendingTotal,
  phaseOf,
  reconcileWithChain,
  type HistoryStatus,
  type OfflineLedger,
  type Phase,
} from "../lib/ledger";
import { lamportsToSol, shortKey } from "../lib/format";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";

const phaseTile: Record<Phase, string> = {
  Active: "bg-blue",
  Expiring: "bg-yellow",
  Releasable: "bg-red",
};

const statusPill: Record<HistoryStatus, string> = {
  SIGNED: "bg-yellow",
  SETTLED: "bg-blue",
  EXPIRED: "bg-stone",
  FAILED: "bg-red/25",
};

const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

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
  const refreshFromEffect = useEffectEvent(() => void refresh());

  useEffect(() => {
    if (online) refreshFromEffect();
  }, [online]);

  useEffect(() => {
    if (!online || !ledger.history?.some((h) => h.status === "SIGNED")) return;
    const id = window.setInterval(() => refreshFromEffect(), 15000);
    return () => window.clearInterval(id);
  }, [online, ledger.reservation, ledger.history]);

  const historyList = [...(ledger.history ?? [])].sort((a, b) => b.createdAt - a.createdAt);

  const metrics = [
    ["Capacity", `${lamportsToSol(BigInt(ledger.capacity))} SOL`],
    ["Committed on-chain", `${lamportsToSol(BigInt(ledger.committedOnChain))} SOL`],
    ["Pending", `${lamportsToSol(pendingTotal(ledger))} SOL (${ledger.pending.length})`],
    ["Per-payment cap", `${lamportsToSol(BigInt(ledger.perPaymentCap))} SOL`],
  ];

  return (
    <PricingCard.Card className="max-w-none rounded-[22px] bg-white p-1.5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)]">
      <PricingCard.Header className={cn("grainy mb-2 rounded-[18px] border-0 p-5", phaseTile[currentPhase])} glassEffect={false}>
        <PricingCard.Plan className="mb-10 gap-3">
          <PricingCard.PlanName className="min-w-0 text-ink">
            <Vault />
            <span className="truncate">
              Reservation <span className="font-mono">{shortKey(ledger.reservation)}</span>
            </span>
          </PricingCard.PlanName>
          <PricingCard.Badge className="shrink-0 border-ink/25 bg-white/55 font-semibold text-ink">{currentPhase}</PricingCard.Badge>
        </PricingCard.Plan>
        <PricingCard.Price className="flex-wrap gap-x-3">
          <PricingCard.MainPrice className="font-display text-[clamp(52px,6vw,76px)] font-black leading-[0.85] tracking-[-0.05em] [font-stretch:85%]">
            {lamportsToSol(availableOffline(ledger))}
          </PricingCard.MainPrice>
          <PricingCard.Period className="text-ink/75">SOL available offline</PricingCard.Period>
        </PricingCard.Price>
        <PricingCard.Description className="text-ink/70">
          Spend until {when(ledger.expiresAt)} · settle by {when(ledger.settleDeadline)}
        </PricingCard.Description>
      </PricingCard.Header>

      <PricingCard.Body className="space-y-5">
        <dl className="m-0 grid grid-cols-2 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-[14px] bg-paper px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="m-0 mt-1 font-mono text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-3">
          <PillButton size="sm" tone="light" text="Refresh from chain" onClick={() => void refresh()} disabled={!online} />
          {!online && <span className="text-sm text-muted-foreground">Offline: showing the local ledger</span>}
        </div>
        {msg && <StatusNote tone={msg.startsWith("Sync failed") ? "error" : "success"}>{msg}</StatusNote>}

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
                  {new Date(h.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · to{" "}
                  {h.merchant ? shortKey(h.merchant) : "—"}
                </span>
                {h.failureReason && <span className="justify-self-end text-xs text-red">{h.failureReason}</span>}
              </li>
            ))}
          </ul>
        )}
      </PricingCard.Body>
    </PricingCard.Card>
  );
}
