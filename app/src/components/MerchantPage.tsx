import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Phone, QrCode, RefreshCw } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { cn } from "@/lib/utils";
import { CLUSTER, USSD_ENABLED, USSD_SERVICE_CODE } from "../config";
import { useMerchantCode } from "../hooks/useMerchantCode";
import { formatMerchantCode, merchantPayments, type MerchantPayment } from "../lib/gateway";
import { notify, reportError } from "../lib/notify";
import { PageHeading } from "./site/PageHeading";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";
import { MerchantSettlement } from "./PaymentFlows";

type Tab = "ussd" | "qr";

const STATUS: Record<MerchantPayment["status"], { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-yellow" },
  sending: { label: "Settling", className: "bg-yellow" },
  settled: { label: "Confirmed", className: "bg-blue" },
  failed: { label: "Failed", className: "bg-red/25" },
};

const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The wallet's merchant code: shown big, copyable, and activated on-chain with one signature. */
export function MerchantCodeCard({ online }: { online: boolean }) {
  const { code, error, activating, activate, canSign } = useMerchantCode(online);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(String(code.code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      notify.warning("Couldn't copy", "Your browser blocked the clipboard.");
    }
  };

  const onActivate = async () => {
    try {
      await activate();
      notify.success("Code activated", "Customers can now pay you by USSD.");
    } catch (e) {
      reportError(e, { title: "Activation failed" });
    }
  };

  return (
    <section aria-labelledby="mcode-title" className="grainy on-dark rounded-[22px] bg-card-dark p-5 text-white sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="mcode-title" className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-white/60">
          Your merchant code
        </h2>
        {code && (
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold text-ink", code.status === "active" ? "bg-blue" : "bg-yellow")}>
            {code.status === "active" ? "Active" : "Not active yet"}
          </span>
        )}
      </div>
      {code ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="m-0 font-mono text-[clamp(34px,7vw,56px)] font-medium leading-none tracking-tight">{formatMerchantCode(code.code)}</p>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Copy merchant code"
              className="grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-white/10 text-white"
            >
              {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
            </button>
          </div>
          {code.status === "active" ? (
            <p className="m-0 mt-4 max-w-xl text-sm leading-relaxed text-white/75">
              Customers dial <b className="text-white">{USSD_SERVICE_CODE}</b>, choose <b className="text-white">1. Pay merchant</b>, type{" "}
              <b className="text-white">{code.code}</b>, the amount and their PIN. The money arrives in this wallet automatically.
              You don&rsquo;t need to do anything.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="m-0 max-w-xl text-sm leading-relaxed text-white/75">
                This code is yours. Activate it once to accept USSD payments: your wallet signs a short message (free, not a
                transaction) and PAT registers the code on-chain so it can only ever pay this wallet.
              </p>
              {!code.canActivate && (
                <p className="m-0 inline-flex rounded-full bg-yellow px-3 py-1 text-xs font-semibold text-ink">
                  Activation isn&rsquo;t switched on for this gateway yet.
                </p>
              )}
              <PillButton
                tone="red"
                text={activating ? "Activating…" : "Activate for USSD"}
                disabled={activating || !online || !canSign || !code.canActivate}
                onClick={() => void onActivate()}
              />
            </div>
          )}
        </>
      ) : (
        <p className="m-0 mt-4 text-sm text-white/75">{error ?? (online ? "Getting your code…" : "Go online to get your code.")}</p>
      )}
    </section>
  );
}

function UssdPayments({ online }: { online: boolean }) {
  const { publicKey } = useWallet();
  const [items, setItems] = useState<MerchantPayment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = publicKey?.toBase58();

  const refresh = useCallback(async () => {
    if (!wallet || !online) return;
    setLoading(true);
    try {
      setItems((await merchantPayments(wallet)).payments);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet, online]);

  useEffect(() => {
    void refresh();
    if (!online) return;
    // Pending payments turn Confirmed within seconds; keep the list fresh while open.
    const t = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(t);
  }, [refresh, online]);

  return (
    <section aria-labelledby="ussd-pay-title" className="rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="ussd-pay-title" className="display-h m-0 text-[clamp(26px,3vw,36px)]">
          Payments received
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !online}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-ink/15 bg-white px-4 text-sm font-semibold disabled:opacity-50"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" /> Refresh
        </button>
      </div>
      <p className="mt-0 mb-5 text-sm text-muted-foreground">
        USSD payments settle themselves: PAT&rsquo;s gateway sends each one on-chain. <b className="text-ink">Confirmed</b> means the
        money is in your wallet.
      </p>
      {!online && <StatusNote tone="warning">Go online to see new payments.</StatusNote>}
      {error && <StatusNote tone="error">{error}</StatusNote>}
      {items && items.length === 0 && <p className="m-0 rounded-[14px] bg-paper px-4 py-6 text-center text-sm text-muted-foreground">No USSD payments yet.</p>}
      {items && items.length > 0 && (
        <ul className="m-0 list-none space-y-2 p-0">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[14px] bg-paper px-4 py-3">
              <span className="font-mono text-base font-semibold">{p.display}</span>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS[p.status].className)}>{STATUS[p.status].label}</span>
              <span className="text-sm text-muted-foreground">from {p.payer}</span>
              <span className="ml-auto text-xs text-muted-foreground">{when(p.createdAt)}</span>
              {p.signature && (
                <a
                  href={`https://explorer.solana.com/tx/${p.signature}?cluster=${CLUSTER}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-ink"
                >
                  Receipt <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MerchantPage({ online }: { online: boolean }) {
  const [tab, setTab] = useState<Tab>(() => (!USSD_ENABLED || window.location.hash === "#qr" ? "qr" : "ussd"));
  const pick = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "qr" ? "#qr" : window.location.pathname);
  };

  const tabs: { id: Tab; title: string; sub: string; icon: typeof QrCode }[] = [
    { id: "ussd", title: "USSD payments", sub: "Your code. Payments arrive by themselves.", icon: Phone },
    { id: "qr", title: "QR payments", sub: "Scan a customer's QR, settle when online.", icon: QrCode },
  ];

  return (
    <main className="page">
      <PageHeading
        eyebrow="Merchant mode"
        lines={["Get", "paid."]}
        lede={
          tab === "ussd"
            ? "Share your merchant code. Customers pay it from any phone by USSD and you see each payment confirm here."
            : "Verify the customer's signed QR on the spot, even offline, then settle it once you are back online."
        }
      />
      {USSD_ENABLED && (
        <div role="tablist" aria-label="Payment type" className="mb-8 grid gap-3 sm:grid-cols-2">
          {tabs.map(({ id, title, sub, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => pick(id)}
              className={cn(
                "flex cursor-pointer items-start gap-4 rounded-[22px] border p-5 text-left transition-shadow",
                tab === id ? "border-ink bg-white shadow-[0_0_0_2px_var(--ink)]" : "border-ink/10 bg-white/70",
              )}
            >
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", id === "qr" ? "bg-blue" : "bg-yellow")}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold">{title}</span>
                <span className="block text-sm text-muted-foreground">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {tab === "ussd" && USSD_ENABLED ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <MerchantCodeCard online={online} />
          <UssdPayments online={online} />
        </div>
      ) : (
        <MerchantSettlement />
      )}
    </main>
  );
}
