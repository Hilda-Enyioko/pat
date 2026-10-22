import { ShieldCheck, Smartphone, Wallet } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import * as PricingCard from "@/components/ui/pricing-card";
import { Mosaic } from "./site/Mosaic";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";
import { MOBILE_WALLET_ADAPTER } from "../hooks/useConnectWallet";

const isIOS = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);

// iOS browsers can't hand off to a wallet app and come back the way Android can,
// so offer to reopen PAT inside the wallet's own browser instead.
function inWalletBrowserLinks() {
  const url = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.origin);
  return [
    { name: "Phantom", href: `https://phantom.app/ul/browse/${url}?ref=${ref}` },
    { name: "Solflare", href: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}` },
  ];
}

export function Connect({
  onConnect,
  onChooseWallet,
  usesMobileWallet,
}: {
  onConnect: () => void;
  onChooseWallet: () => void;
  usesMobileWallet: boolean;
}) {
  const { wallets, wallet, connecting } = useWallet();
  const installed = wallets.some((wallet) => wallet.readyState === "Installed") || Boolean(window.solflare?.isSolflare);
  const ios = !installed && isIOS();
  const viaWalletApp = usesMobileWallet || wallet?.adapter.name === MOBILE_WALLET_ADAPTER;
  let label = wallet ? `Connect ${wallet.adapter.name}` : "Choose wallet";
  if (viaWalletApp) label = "Connect wallet";
  if (connecting) label = viaWalletApp ? "Waiting for your wallet app…" : "Connecting…";

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
              {usesMobileWallet
                ? "Opens your wallet app (Phantom, Solflare or another Solana wallet). Approve there and you'll come straight back here."
                : "Solflare, Phantom, Backpack or any Wallet Standard wallet installed in this browser."}
            </PricingCard.Description>
            <PillButton text={label} disabled={connecting} onClick={onConnect} className="w-full" />
            {(wallet || usesMobileWallet) && (
              <button
                type="button"
                onClick={onChooseWallet}
                className="mt-3 w-full cursor-pointer border-0 bg-transparent p-1 text-sm font-semibold text-ink underline underline-offset-4"
              >
                Use a different wallet
              </button>
            )}
          </PricingCard.Header>
          <PricingCard.Body className="space-y-3">
            {usesMobileWallet && (
              <PricingCard.List>
                <PricingCard.ListItem>
                  <Smartphone className="size-4 shrink-0 text-ink" aria-hidden="true" />
                  <span>Tap Connect, approve in your wallet app, and Android brings you back to Chrome connected.</span>
                </PricingCard.ListItem>
              </PricingCard.List>
            )}
            {ios && (
              <div className="space-y-3 rounded-[14px] bg-paper p-4">
                <p className="m-0 text-sm">
                  On iPhone, wallets can&rsquo;t connect to Safari or Chrome directly. Open PAT inside your wallet&rsquo;s
                  browser instead:
                </p>
                <div className="flex flex-wrap gap-2">
                  {inWalletBrowserLinks().map((link) => (
                    <a
                      key={link.name}
                      href={link.href}
                      className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-semibold text-white no-underline"
                    >
                      Open in {link.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {!installed && !usesMobileWallet && !ios && (
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
