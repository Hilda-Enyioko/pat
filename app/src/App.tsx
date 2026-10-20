import { motion, AnimatePresence, type Variants } from "framer-motion";
import "./App.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Providers } from "./components/Providers";
import { ReserveForm } from "./components/ReserveForm";
import { LedgerPanel } from "./components/LedgerPanel";
import { MerchantSettlement, SignPayment } from "./components/PaymentFlows";
import { WalletHistory } from "./components/WalletHistory";
import { isLocked, isSignable, listLedgers, type OfflineLedger } from "./lib/ledger";
import { shortKey } from "./lib/format";
import { useOnline } from "./hooks/useOnline";
import { useWalletHistory } from "./hooks/useWalletHistory";
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
const validViews: View[] = ["landing", "connect", "ledger", "reserve", "sign", "merchant"];

const NAV_ITEMS: { view: View; label: string }[] = [
  { view: "ledger", label: "Ledger" },
  { view: "reserve", label: "Reserve" },
  { view: "sign", label: "Sign" },
  { view: "merchant", label: "Merchant" },
];

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
  onToggleOnline,
}: {
  view: View;
  setView: (v: View) => void;
  onDisconnect: () => void;
  publicKey: string | null;
  online: boolean;
  onToggleOnline: () => void;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 552) setMobileMenuOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleNavigate = (next: View) => {
    setView(next);
    setMobileMenuOpen(false);
  };

  const handleDisconnect = () => {
    onDisconnect();
    setMobileMenuOpen(false);
  };

  const statusIndicator = (
    <button
      type="button"
      className={online ? "online-indicator" : "offline-badge"}
      onClick={onToggleOnline}
      title={`Currently ${online ? "Online" : "Offline"}. Click to toggle mode.`}
      aria-label={`Toggle network status, currently ${online ? "Online" : "Offline"}`}
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        font: "inherit",
        padding: 0,
      }}
    >
      {online ? "Online" : "Offline"}
    </button>
  );

  return (
    <header className="site-nav">
      <button
        type="button"
        className="brand"
        onClick={() => handleNavigate("landing")}
        aria-label="PAT home"
      >
        <img src={logoUrl} alt="PAT" />
        <span>PAT</span>
      </button>

      <nav className="nav-links" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={view === item.view ? "active" : ""}
            onClick={() => handleNavigate(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="nav-actions">
        {publicKey ? (
          <>
            <span className="wallet-chip desktop-only">{shortKey(publicKey)}</span>
            {statusIndicator}
            <button type="button" className="text-button desktop-only" onClick={handleDisconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            {statusIndicator}
            <WalletMultiButton />
          </>
        )}

        <button
          type="button"
          className="mobile-menu-trigger"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="mobile-dropdown-menu">
          {publicKey && (
            <div className="mobile-dropdown-wallet">
              <span className="wallet-chip">{shortKey(publicKey)}</span>
            </div>
          )}

          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`mobile-menu-item ${view === item.view ? "active" : ""}`}
              onClick={() => handleNavigate(item.view)}
            >
              {item.label}
            </button>
          ))}

          {publicKey && (
            <>
              <div className="mobile-dropdown-divider" />
              <button
                type="button"
                className="mobile-menu-item disconnect-item"
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}

function Landing({ onStart }: { onStart: () => void }) {
  const scrollToHow = () =>
    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });

  return (
    <main className="landing">
      <section className="landing-hero anim go">
        <div
          className="globe-bg"
          role="img"
          aria-label="Spinning globe rendered as a blue dot matrix with payment arcs, against a starfield"
        >
          <Globe />
        </div>
        <div className="hero-vignette" />
        <div className="hero-inner">
          <h1>
            <span className="ln">
              <span className="ln-i">Reserve online.</span>
            </span>
            <span className="ln">
              <span className="ln-i">
                <em>Pay offline.</em>
              </span>
            </span>
          </h1>
          <p className="hero-lede">
            Turn a connected wallet into a bounded offline allowance on Solana,
            <br />
            sign payments the moment the network disappears,
            <br />
            and let merchants settle when they reconnect.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStart}>
              Connect wallet <Arrow />
            </button>
            <button className="quiet-button" onClick={scrollToHow}>
              How it works <span>↓</span>
            </button>
          </div>
          <div className="trust-line">
            <span className="online-indicator">● live on {CLUSTER}</span>
          </div>
        </div>
        <button className="scroll-cue" onClick={scrollToHow}>
          Scroll <span>⌄</span>
        </button>
      </section>
      <section id="how-it-works" className="feature-strip page-shell">
        <div>
          <span>01</span>
          <h2>Reserve online</h2>
          <p>Set a bounded allowance before connectivity fails.</p>
        </div>
        <div>
          <span>02</span>
          <h2>Sign offline</h2>
          <p>Your wallet authorizes each payment without a network.</p>
        </div>
        <div>
          <span>03</span>
          <h2>Merchant settles</h2>
          <p>Payments become verifiable proof when you reconnect.</p>
        </div>
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
  const { online: systemOnline } = useOnline();
  const [manualOnline, setManualOnline] = useState<boolean | null>(null);
  const offlineReady = useOfflineReady();

  const online = manualOnline ?? systemOnline;

  const toggleOnline = useCallback(() => {
    setManualOnline((prev) => !(prev ?? systemOnline));
  }, [systemOnline]);

  const [view, setViewState] = useState<View>(() => {
    const candidate = window.location.pathname.replace(/^\/|\/$/g, "") as View;
    return validViews.includes(candidate) ? candidate : "landing";
  });
  const [ledgers, setLedgers] = useState<OfflineLedger[]>([]);

  const setView = useCallback((next: View) => {
    setViewState(next);
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

  useEffect(() => {
    const handlePopState = () => {
      const candidate = window.location.pathname.replace(/^\/|\/$/g, "") as View;
      setViewState(validViews.includes(candidate) ? candidate : "landing");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!publicKey && view !== "landing" && view !== "connect") {
      setView("connect");
    }
  }, [publicKey, view, setView]);

  useEffect(() => {
    if (!publicKey || view !== "connect" || !ready) return;
    void listLedgers(publicKey.toBase58()).then((items) => {
      setLedgers(items);
      const hasChainReservations = (history?.reservations.length ?? 0) > 0;
      setView(items.length || hasChainReservations ? "ledger" : "reserve");
    });
  }, [publicKey, view, ready, history, setView]);

  const guardedView =
    publicKey || view === "landing" || view === "connect" ? view : "connect";

  const disconnectWallet = () => {
    void disconnect();
    setView("landing");
  };

  const syncing = loading || !ready;
  const hasHistory = (history?.timeline.length ?? 0) > 0;

  let content: ReactNode;
  if (guardedView === "landing") {
    content = <Landing onStart={() => (publicKey ? setView("ledger") : setView("connect"))} />;
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
          syncing ? (
            <div className="empty-state">
              <h2>Reading your history…</h2>
              <p>Looking up this wallet on {CLUSTER}.</p>
            </div>
          ) : (
            <div className="empty-state">
              <h2>{hasHistory ? "No active reservations." : "Your ledger is waiting."}</h2>
              <p>
                {hasHistory
                  ? "Create a new reservation to spend offline again."
                  : "Create your first reservation to see your available offline balance here."}
              </p>
              <button className="primary-button" onClick={() => setView("reserve")}>
                Create reservation <Arrow />
              </button>
            </div>
          )
        ) : (
          ledgers.map((ledger) => (
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
          ))
        )}

        <WalletHistory
          history={history}
          loading={loading}
          error={error}
          online={online}
          onRefresh={() => void refreshHistory()}
        />
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
    <div className="app-shell">
      <Nav
        view={guardedView}
        setView={setView}
        onDisconnect={disconnectWallet}
        publicKey={publicKey?.toBase58() ?? null}
        online={online}
        onToggleOnline={toggleOnline}
      />
      {offlineReady && (
        <div className="offline-ready" role="status">
          Offline payments ready on this device
        </div>
      )}

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
