import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Providers } from "./components/Providers";
import { ReserveForm } from "./components/ReserveForm";
import { LedgerPanel } from "./components/LedgerPanel";
import { MerchantSettlement, SignPayment } from "./components/PaymentFlows";
import { Landing } from "./components/Landing";
import { Connect } from "./components/Connect";
import { Header } from "./components/site/Header";
import { HowItWorks } from "./components/site/HowItWorks";
import { PageHeading } from "./components/site/PageHeading";
import { PillButton } from "./components/site/Pill";
import { WalletHistory } from "./components/WalletHistory";
import { isLocked, isSignable, listLedgers, type OfflineLedger } from "./lib/ledger";
import { useWalletHistory } from "./hooks/useWalletHistory";
import { validViews, type View } from "./lib/views";
import { useNetwork } from "./hooks/useNetwork";
import { Notifier } from "./components/site/Notifier";
import { notify } from "./lib/notify";
import { useConnectWallet } from "./hooks/useConnectWallet";
import { readOfflinePref, setAppOffline, writeOfflinePref } from "./lib/network";
import { CLUSTER, RPC_URL } from "./config";

const viewVariants: Variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeIn" } },
};

function useOfflineReadyToast() {
  useEffect(() => {
    const onReady = () => notify.success("Ready for offline payments", "PAT is cached on this device and works with no signal.");
    window.addEventListener("pat:offline-ready", onReady);
    return () => window.removeEventListener("pat:offline-ready", onReady);
  }, []);
}

function AppContent() {
  const { publicKey, disconnect } = useWallet();
  const { connectWallet, chooseWallet } = useConnectWallet();
  const reachable = useNetwork();
  const [offlinePref, setOfflinePref] = useState(readOfflinePref);
  const [howOpen, setHowOpen] = useState(false);
  useOfflineReadyToast();

  // Online only when the network is really there AND the user hasn't chosen offline mode.
  // Losing the connection flips this automatically; it flips back when the
  // connection returns, unless the user picked offline mode themselves.
  const online = reachable && !offlinePref;
  // Set during render, not in an effect: children's effects (ledger sync) run
  // before ours and must already see the right mode.
  setAppOffline(!online);

  const toggleOnline = useCallback(() => {
    // With no network there is nothing to switch to; the toggle just reports it.
    if (!reachable) return;
    setOfflinePref((prev) => {
      writeOfflinePref(!prev);
      return !prev;
    });
  }, [reachable]);

  // Initialize view from URL path
  const [view, setViewState] = useState<View>(() => {
    const candidate = window.location.pathname.replace(/^\/|\/$/g, "") as View;
    return validViews.includes(candidate) ? candidate : "landing";
  });
  const [ledgers, setLedgers] = useState<OfflineLedger[]>([]);

  // Update browser history via pushState on navigation
  const setView = useCallback((next: View) => {
    setViewState(next);
    window.scrollTo(0, 0);
    const targetPath = next === "landing" ? "/" : `/${next}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, "", targetPath);
    }
  }, []);

  const reload = useCallback(async () => {
    setLedgers(publicKey ? await listLedgers(publicKey.toBase58()) : []);
  }, [publicKey]);

  const { history, loading, error, ready, refresh: refreshHistory } = useWalletHistory(online, reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Synchronize browser forward/back buttons
  useEffect(() => {
    const handlePopState = () => {
      const candidate = window.location.pathname.replace(/^\/|\/$/g, "") as View;
      setViewState(validViews.includes(candidate) ? candidate : "landing");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Guard: if no wallet is connected and trying to access app paths, route to /connect
  useEffect(() => {
    if (!publicKey && view !== "landing" && view !== "connect") {
      setView("connect");
    }
  }, [publicKey, view, setView]);

  // Once connected and the chain history is read, transition from connect page to ledger/reserve
  useEffect(() => {
    if (!publicKey || view !== "connect" || !ready) return;
    void listLedgers(publicKey.toBase58()).then((items) => {
      setLedgers(items);
      const hasChainReservations = (history?.reservations.length ?? 0) > 0;
      setView(items.length || hasChainReservations ? "ledger" : "reserve");
    });
  }, [publicKey, view, ready, history, setView]);

  // Determine view to render: fall back to "connect" if unauthenticated
  const guardedView =
    publicKey || view === "landing" || view === "connect" ? view : "connect";

  // The landing is a viewport-locked composition: no document scroll.
  useEffect(() => {
    document.documentElement.classList.toggle("locked", guardedView === "landing");
  }, [guardedView]);

  const disconnectWallet = () => {
    void disconnect();
    setView("landing");
  };


  const syncing = loading || !ready;
  const hasHistory = (history?.timeline.length ?? 0) > 0;
  const start = () => (publicKey ? setView("ledger") : setView("connect"));

  const header = (
    <Header
      view={guardedView}
      onNavigate={setView}
      publicKey={publicKey?.toBase58() ?? null}
      online={online}
      reachable={reachable}
      onToggleOnline={toggleOnline}
      onConnect={connectWallet}
      onDisconnect={disconnectWallet}
      onHowItWorks={() => setHowOpen(true)}
    />
  );

  const overlays = (
    <>
      <HowItWorks open={howOpen} onClose={() => setHowOpen(false)} onStart={start} />
    </>
  );

  if (guardedView === "landing") {
    return (
      <>
        <Landing header={header} connected={Boolean(publicKey)} onStart={start} onHowItWorks={() => setHowOpen(true)} />
        {overlays}
      </>
    );
  }

  let content: ReactNode;
  if (guardedView === "connect") {
    content = <Connect onConnect={connectWallet} onChooseWallet={chooseWallet} />;
  } else if (guardedView === "ledger") {
    content = (
      <main className="page">
        <PageHeading
          eyebrow="Your offline ledger"
          lines={["Know what", "you can", "spend."]}
          lede="Your ledger lives on this device and fails closed when it cannot verify your allowance."
          aside={<PillButton size="lg" text="Reserve funds" onClick={() => setView("reserve")} />}
        />
        {ledgers.length === 0 ? (
          syncing ? (
            <section className="grainy flex flex-col items-start gap-4 rounded-[22px] bg-blue p-6 sm:p-10">
              <h2 className="display-h text-[clamp(32px,4.4vw,56px)]">Reading your history…</h2>
              <p className="m-0 max-w-md text-[17px] leading-relaxed">Looking up this wallet on {CLUSTER}.</p>
            </section>
          ) : (
            <section className="grainy flex flex-col items-start gap-6 rounded-[22px] bg-red p-6 sm:p-10">
              <h2 className="display-h text-[clamp(36px,5vw,64px)]">
                {hasHistory ? (
                  <>
                    No active
                    <br />
                    reservations.
                  </>
                ) : (
                  <>
                    Your ledger
                    <br />
                    is waiting.
                  </>
                )}
              </h2>
              <p className="m-0 max-w-md text-[17px] leading-relaxed">
                {hasHistory
                  ? "Create a new reservation to spend offline again."
                  : "Create your first reservation to see your available offline balance here."}
              </p>
              <PillButton size="lg" text="Create reservation" onClick={() => setView("reserve")} />
            </section>
          )
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {ledgers.map((ledger) => (
              <LedgerPanel
                key={ledger.reservation}
                ledger={ledger}
                online={online}
                onChange={() => void reload()}
                onWithdrawn={() => {
                  void reload();
                  void refreshHistory();
                }}
              />
            ))}
          </div>
        )}

        <WalletHistory history={history} loading={loading} error={error} online={online} onRefresh={() => void refreshHistory()} />
      </main>
    );
  } else if (guardedView === "reserve") {
    content = (
      <main className="page">
        <PageHeading
          eyebrow="Step 2 / 3"
          lines={["Reserve", "offline", "funds."]}
          lede="Lock a bounded allowance while connected. Unspent funds return after the settle window."
          aside={
            <span className="inline-flex items-center gap-2 self-end rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold">
              <span aria-hidden="true" className={online ? "size-2 rounded-full bg-[#3fb36b]" : "size-2 rounded-full bg-red"} />
              {online ? "Online" : "Offline"}
            </span>
          }
        />
        <ReserveForm
          onCreated={() => {
            void reload();
            void refreshHistory();
            setView("ledger");
          }}
        />
      </main>
    );
  } else if (guardedView === "sign") {
    const signable = ledgers.filter(isSignable);
    const lockedCount = ledgers.filter(isLocked).length;
    content = <SignPayment ledgers={signable} lockedCount={lockedCount} />;
  } else {
    content = <MerchantSettlement />;
  }

  return (
    <div className="shell">
      {header}
      <AnimatePresence mode="wait">
        <motion.div
          key={guardedView}
          variants={viewVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex w-full flex-1 flex-col"
        >
          {content}
        </motion.div>
      </AnimatePresence>
      <footer className="mx-auto flex w-[min(1200px,calc(100%-2*var(--gut)))] flex-wrap justify-between gap-2 border-t border-ink/10 py-6 text-xs text-muted-foreground">
        <span>PAT · Primitive Airborne Transaction</span>
        <span>
          {CLUSTER} · {new URL(RPC_URL).host}
        </span>
      </footer>
      {overlays}
    </div>
  );
}

export default function App() {
  return (
    <Providers>
      <AppContent />
      <Notifier />
    </Providers>
  );
}

declare global {
  interface Window {
    solflare?: { isSolflare?: boolean };
  }
}
