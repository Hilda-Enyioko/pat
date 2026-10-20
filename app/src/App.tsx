import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
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
import { listLedgers, type OfflineLedger } from "./lib/ledger";
import { validViews, type View } from "./lib/views";
import { useOnline } from "./hooks/useOnline";
import { CLUSTER, RPC_URL } from "./config";

const viewVariants: Variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeIn" } },
};

function useOfflineReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const onReady = () => {
      setReady(true);
      timer = window.setTimeout(() => setReady(false), 6000);
    };
    window.addEventListener("pat:offline-ready", onReady);
    return () => {
      window.removeEventListener("pat:offline-ready", onReady);
      window.clearTimeout(timer);
    };
  }, []);
  return ready;
}

function AppContent() {
  const { publicKey, disconnect } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const { online: systemOnline } = useOnline();
  const [manualOnline, setManualOnline] = useState<boolean | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const offlineReady = useOfflineReady();

  // If the user manually toggled the mode, honor manualOnline; otherwise follow browser network state
  const online = manualOnline ?? systemOnline;

  const toggleOnline = useCallback(() => {
    setManualOnline((prev) => !(prev ?? systemOnline));
  }, [systemOnline]);

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

  // Once connected, transition from connect page to ledger/reserve
  useEffect(() => {
    if (!publicKey) return;
    void listLedgers(publicKey.toBase58()).then((items) => {
      setLedgers(items);
      if (view === "connect") {
        setView(items.length ? "ledger" : "reserve");
      }
    });
  }, [publicKey, view, setView]);

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

  const openWalletModal = () => setWalletModalVisible(true);
  const start = () => (publicKey ? setView("ledger") : setView("connect"));

  const header = (
    <Header
      view={guardedView}
      onNavigate={setView}
      publicKey={publicKey?.toBase58() ?? null}
      online={online}
      onToggleOnline={toggleOnline}
      onConnect={openWalletModal}
      onDisconnect={disconnectWallet}
      onHowItWorks={() => setHowOpen(true)}
    />
  );

  const overlays = (
    <>
      <HowItWorks open={howOpen} onClose={() => setHowOpen(false)} onStart={start} />
      {offlineReady && (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 inline-flex items-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-[0_16px_36px_-16px_rgba(15,15,14,.6)]"
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-blue" />
          Offline payments ready on this device
        </div>
      )}
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
    content = <Connect onConnect={openWalletModal} />;
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
          <section className="grainy flex flex-col items-start gap-6 rounded-[22px] bg-red p-6 sm:p-10">
            <h2 className="display-h text-[clamp(36px,5vw,64px)]">
              Your ledger
              <br />
              is waiting.
            </h2>
            <p className="m-0 max-w-md text-[17px] leading-relaxed">
              Create your first reservation to see your available offline balance here.
            </p>
            <PillButton size="lg" text="Create reservation" onClick={() => setView("reserve")} />
          </section>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {ledgers.map((ledger) => (
              <LedgerPanel key={ledger.reservation} ledger={ledger} online={online} onChange={() => void reload()} />
            ))}
          </div>
        )}
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
            setView("ledger");
          }}
        />
      </main>
    );
  } else if (guardedView === "sign") {
    content = <SignPayment ledgers={ledgers} />;
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
    </Providers>
  );
}

declare global {
  interface Window {
    solflare?: { isSolflare?: boolean };
  }
}
