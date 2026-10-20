import { History as HistoryIcon } from "lucide-react";
import * as PricingCard from "@/components/ui/pricing-card";
import { cn } from "@/lib/utils";
import type { TimelineKind, WalletHistory as History } from "../lib/chainHistory";
import { lamportsToSol, shortKey } from "../lib/format";
import { CLUSTER } from "../config";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";

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

const PILL: Record<TimelineKind, string> = {
  RESERVED: "bg-blue",
  WITHDRAWN: "bg-stone",
  SENT: "bg-red/25",
  RECEIVED: "bg-yellow",
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
    <PricingCard.Card className="mt-6 max-w-none rounded-[22px] bg-white p-1.5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)]">
      <PricingCard.Header className="mb-2 rounded-[18px] border-ink/8 bg-card-cream p-5" glassEffect={false}>
        <PricingCard.Plan className="mb-0 flex-wrap gap-3">
          <PricingCard.PlanName className="text-ink">
            <HistoryIcon />
            <span>Wallet history</span>
          </PricingCard.PlanName>
          <div className="flex items-center gap-3">
            <PricingCard.Badge className="border-ink/20 bg-white font-semibold text-ink">
              {!online ? "Cached" : loading ? "Syncing…" : "On-chain"}
            </PricingCard.Badge>
            <PillButton size="sm" tone="light" text="Refresh" onClick={onRefresh} disabled={!online || loading} />
          </div>
        </PricingCard.Plan>
      </PricingCard.Header>

      <PricingCard.Body className="space-y-4">
        {error && <StatusNote tone="error">Sync failed: {error}</StatusNote>}
        {!online && <p className="m-0 text-sm text-muted-foreground">Offline. Showing the last synced history for this wallet.</p>}

        {items.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            {loading ? "Reading the chain…" : "No on-chain activity for this wallet yet."}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((i) => (
              <li
                key={i.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 rounded-[14px] border border-ink/8 px-4 py-3"
              >
                <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide", PILL[i.kind])}>
                  {LABEL[i.kind]}
                </span>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {i.at ? new Date(i.at * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  {i.counterparty ? ` · ${shortKey(i.counterparty)}` : ""}
                </span>
                <span className="text-right font-mono text-sm font-semibold">
                  {SIGN[i.kind]}
                  {lamportsToSol(BigInt(i.amount))} SOL
                </span>
                {i.signature && (
                  <a
                    className="col-span-3 justify-self-end font-mono text-xs text-ink underline underline-offset-4"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://explorer.solana.com/tx/${i.signature}?cluster=${CLUSTER}`}
                  >
                    {i.signature.slice(0, 6)}… on explorer
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </PricingCard.Body>
    </PricingCard.Card>
  );
}
