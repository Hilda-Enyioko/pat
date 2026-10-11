import { motion, AnimatePresence, type Variants } from "framer-motion";
import "./App.css";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Providers } from "./components/Providers";
import { ReserveForm } from "./components/ReserveForm";
import { LedgerPanel } from "./components/LedgerPanel";
import { MerchantSettlement, SignPayment } from "./components/PaymentFlows";
import { listLedgers, type OfflineLedger } from "./lib/ledger";
import { shortKey } from "./lib/format";
import { useOnline } from "./hooks/useOnline";
import { CLUSTER, RPC_URL } from "./config";
import { Globe } from "./components/Globe";

const logoUrl = "/logo.png";

const viewVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeIn" } },
};

function useOfflineReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onReady = () => setReady(true);
    window.addEventListener("pat:offline-ready", onReady);
    return () => window.removeEventListener("pat:offline-ready", onReady);
  }, []);
  return ready;
}

type View = "landing" | "connect" | "ledger" | "reserve" | "sign" | "merchant";
const hashViews: View[] = ["ledger", "reserve", "sign", "merchant"];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function WalletGate() {
  const { wallets } = useWallet();
  const installed =
    wallets.some((wallet) => wallet.readyState === "Installed") ||
    Boolean(window.solflare?.isSolflare);
  return (
    <div className="wallet-hints">
      {!installed && (
        <p>
          No wallet extension detected in this browser tab. Install Solflare, enable
          it for this site (and for Incognito if applicable), then reload.
        </p>
      )}
      <p>Set Solflare to Devnet: Settings &gt; Network &gt; Devnet.</p>
    </div>
  );
}

function Nav({
  view,
  setView,
  onDisconnect,
  publicKey,
  online,
}: {
  view: View;
  setView: (v: View) => void;
  onDisconnect: () => void;
  publicKey: string | null;
  online: boolean;
}) {
  return (
    <header className="site-nav">
      <button
        className="brand"
        onClick={() => setView("landing")}
        aria-label="PAT home"
      >
        <img src={logoUrl} alt="PAT" />
        <span>PAT</span>
      </button>
      <nav className="nav-links" aria-label="Primary navigation">
        <button
          className={view === "ledger" ? "active" : ""}
          onClick={() => setView("ledger")}
        >
          Ledger
        </button>
        <button
          className={view === "reserve" ? "active" : ""}
          onClick={() => setView("reserve")}
        >
          Reserve Funds
        </button>
        <button
          className={view === "sign" ? "active" : ""}
          onClick={() => setView("sign")}
        >
          Sign payment
        </button>
        <button
          className={view === "merchant" ? "active" : ""}
          onClick={() => setView("merchant")}
        >
          Merchant
        </button>
      </nav>
      <div className="nav-actions">
        {publicKey ? (
          <>
            <span className="wallet-chip">{shortKey(publicKey)}</span>
            <span className={online ? "online-indicator" : "offline-badge"}>
              {online ? "Online" : "Offline"}
            </span>
            <button className="text-button" onClick={onDisconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <WalletMultiButton />
        )}
      </div>
    </header>
  );
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <main className="landing">
      <section className="landing-hero">
        <div className="globe-bg" role="img" aria-label="Spinning globe rendered as a blue dot matrix with payment arcs, against a starfield"><Globe /></div>
        <div className="hero-vignette" />
        <div className="hero-inner">
          <h1><span className="ln"><span className="ln-i">Reserve online.</span></span><span className="ln"><span className="ln-i"><em>Pay offline.</em></span></span></h1>
          <p className="hero-lede">Turn a connected wallet into a bounded offline allowance on Solana,<br />sign payments the moment the network disappears,<br />and let merchants settle when they reconnect.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStart}>Connect wallet <Arrow /></button>
            <button className="quiet-button" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>How it works <span>↓</span></button>
          </div>
          <div className="trust-line"><span className="online-indicator">● live on {CLUSTER}</span></div>
        </div>
        <button className="scroll-cue" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>Scroll <span>⌄</span></button>
      </section>
      <section id="how-it-works" className="feature-strip page-shell">
        <div><span>01</span><h2>Reserve online</h2><p>Set a bounded allowance before connectivity fails.</p></div>
        <div><span>02</span><h2>Sign offline</h2><p>Your wallet authorizes each payment without a network.</p></div>
        <div><span>03</span><h2>Merchant settles</h2><p>Payments become verifiable proof when you reconnect.</p></div>
      </section>
    </main>
  );
}

function Connect() {
  return (
    <main className="centered-page">
      <section className="connect-card">
        <div className="step-count">STEP 1 / 3</div>
        <h1>Connect your wallet.</h1>
        <p className="muted">
          PAT never takes custody of your funds. Connect the wallet you&apos;ll use
          to reserve an offline allowance.
        </p>
        <div className="wallet-panel">
          <div className="wallet-icon">◎</div>
          <div>
            <strong>Your Solana wallet</strong>
            <span>Solflare, Phantom, or another installed wallet</span>
          </div>
          <WalletMultiButton />
        </div>
        <WalletGate />
        <div className="security-note">
          <span>⌁</span>
          <p>Non-custodial by default. PAT only signs instructions you approve.</p>
        </div>
      </section>
    </main>
  );
}

function AppContent() {
  const { publicKey, disconnect } = useWallet();
  const online = useOnline();
  const offlineReady = useOfflineReady();
  const [view, setViewState] = useState<View>(() => {
    const candidate = window.location.hash.replace("#/", "") as View;
    return hashViews.includes(candidate) ? candidate : "landing";
  });
  const [ledgers, setLedgers] = useState<OfflineLedger[]>([]);

  const setView = useCallback((next: View) => {
    setViewState(next);
    if (next === "landing" || next === "connect") {
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      window.history.replaceState(null, "", `#/${next}`);
    }
  }, []);

  const reload = useCallback(async () => {
    setLedgers(publicKey ? await listLedgers(publicKey.toBase58()) : []);
  }, [publicKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!publicKey) {
      if (view !== "landing" && view !== "connect") setView("landing");
      return;
    }
  }, [publicKey, view, setView]);

  useEffect(() => {
    if (!publicKey) return;
    void listLedgers(publicKey.toBase58()).then((items) => {
      setLedgers(items);
      if (view === "connect") {
        setView(items.length ? "ledger" : "reserve");
      }
    });
  }, [publicKey, view, setView]);

  const guardedView =
    publicKey || view === "landing" || view === "connect" ? view : "connect";

  const disconnectWallet = () => {
    void disconnect();
    setView("landing");
  };

  let content: ReactNode;
  if (guardedView === "landing") {
    content = (
      <Landing
        onStart={() => (publicKey ? setView("ledger") : setView("connect"))}
      />
    );
  } else if (guardedView === "connect") {
    content = <Connect />;
  } else if (guardedView === "ledger") {
    content = (
      <main className="workspace page-shell">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Your offline ledger</p>
            <h1>Know what you can spend.</h1>
            <p className="muted">
              Your ledger is persisted on this device and fails closed when it cannot
              verify your allowance.
            </p>
          </div>
          <button className="primary-button" onClick={() => setView("reserve")}>
            Reserve funds <Arrow />
          </button>
        </div>
        {ledgers.length === 0 ? (
          <div className="empty-state">
            <h2>Your ledger is waiting.</h2>
            <p>
              Create your first reservation to see your available offline balance
              here.
            </p>
            <button className="primary-button" onClick={() => setView("reserve")}>
              Create reservation <Arrow />
            </button>
          </div>
        ) : (
          ledgers.map((ledger) => (
            <LedgerPanel
              key={ledger.reservation}
              ledger={ledger}
              online={online}
              onChange={() => void reload()}
            />
          ))
        )}
      </main>
    );
  } else if (guardedView === "reserve") {
    content = (
      <main className="workspace page-shell">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Step 2 / 3</p>
            <h1>Reserve your offline funds.</h1>
            <p className="muted">
              Lock a bounded allowance while connected. Unspent funds return after
              the settle window.
            </p>
          </div>
          <span className="online-badge">● {online ? "Online" : "Offline"}</span>
        </div>
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
    <div className="app-shell">
      <Nav
        view={guardedView}
        setView={setView}
        onDisconnect={disconnectWallet}
        publicKey={publicKey?.toBase58() ?? null}
        online={online}
      />
      {offlineReady && (
        <div className="offline-ready" role="status">
          Offline payments ready on this device
        </div>
      )}

      {/* Smooth cross-fade view transition */}
      <AnimatePresence mode="wait">
        <motion.div
          key={guardedView}
          variants={viewVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          style={{ width: "100%", display: "flex", flexDirection: "column", flex: 1 }}
        >
          {content}
        </motion.div>
      </AnimatePresence>

      <footer className="site-footer">
        <span>
          {CLUSTER} · {new URL(RPC_URL).host}
        </span>
      </footer>
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

export { logoUrl };

declare global {
  interface Window {
    solflare?: { isSolflare?: boolean };
  }
}
