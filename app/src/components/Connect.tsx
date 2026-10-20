import { ShieldCheck, Wallet } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import * as PricingCard from "@/components/ui/pricing-card";
import { Mosaic } from "./site/Mosaic";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";

export function Connect({ onConnect }: { onConnect: () => void }) {
  const { wallets, connecting } = useWallet();
  const installed = wallets.some((wallet) => wallet.readyState === "Installed") || Boolean(window.solflare?.isSolflare);

  return (
    <main className="page grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      <div className="min-w-0">
        <p className="m-0 inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em]">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-red" />
          Step 1 / 3
        </p>
        <h1 className="display-h mt-5 text-[clamp(46px,8.4vw,104px)]">
          <span className="block">Connect</span>
          <span className="block">your</span>
          <span className="block">wallet.</span>
        </h1>
        <p className="mt-5 mb-8 max-w-lg text-[17px] leading-relaxed text-ink/80">
          PAT never takes custody of your funds. Connect the wallet you&rsquo;ll use to reserve an offline allowance.
        </p>

        <PricingCard.Card className="max-w-xl rounded-[22px] bg-white shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)]">
          <PricingCard.Header className="mb-0 rounded-[18px] border-ink/8 bg-card-cream" glassEffect={false}>
            <PricingCard.Plan className="mb-6">
              <PricingCard.PlanName className="text-ink">
                <Wallet />
                <span>Your Solana wallet</span>
              </PricingCard.PlanName>
              <PricingCard.Badge>Devnet</PricingCard.Badge>
            </PricingCard.Plan>
            <PricingCard.Description className="mb-5 text-sm">
              Solflare, Phantom, Backpack or any Wallet Standard wallet installed in this browser.
            </PricingCard.Description>
            <PillButton text={connecting ? "Connecting…" : "Choose wallet"} disabled={connecting} onClick={onConnect} className="w-full" />
          </PricingCard.Header>
          <PricingCard.Body className="space-y-3">
            {!installed && (
              <StatusNote tone="warning">
                No wallet extension detected in this tab. Install Solflare, enable it for this site (and for Incognito if
                applicable), then reload.
              </StatusNote>
            )}
            <PricingCard.List>
              <PricingCard.ListItem>
                <span className="mt-1 size-2 shrink-0 rounded-full bg-blue" aria-hidden="true" />
                <span>Set your wallet to Devnet: Settings &gt; Network &gt; Devnet.</span>
              </PricingCard.ListItem>
              <PricingCard.ListItem>
                <ShieldCheck className="size-4 shrink-0 text-ink" aria-hidden="true" />
                <span>Non-custodial by default. PAT only signs instructions you approve.</span>
              </PricingCard.ListItem>
            </PricingCard.List>
          </PricingCard.Body>
        </PricingCard.Card>
      </div>

      <div className="relative hidden h-[min(680px,72svh)] overflow-hidden rounded-[22px] lg:block">
        <Mosaic className="mosaic-box" />
      </div>
    </main>
  );
}
