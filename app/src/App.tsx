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
const validViews: View[] = ["landing", "connect", "ledger", "reserve", "sign", "merchant"];

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
      if (window.innerWidth > 552) {
        setMobileMenuOpen(false);
      }
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

      {/* Desktop Navigation Links */}
      <nav className="nav-links" aria-label="Primary navigation">
        <button
          type="button"
          className={view === "ledger" ? "active" : ""}
          onClick={() => handleNavigate("ledger")}
        >
          Ledger
        </button>
        <button
          type="button"
          className={view === "reserve" ? "active" : ""}
          onClick={() => handleNavigate("reserve")}
        >
          Reserve
        </button>
        <button
          type="button"
          className={view === "sign" ? "active" : ""}
          onClick={() => handleNavigate("sign")}
        >
          Sign
        </button>
        <button
          type="button"
          className={view === "merchant" ? "active" : ""}
          onClick={() => handleNavigate("merchant")}
        >
          Merchant
        </button>
      </nav>

      {/* Action Strip */}
      <div className="nav-actions">
        {publicKey ? (
          <>
            <span className="wallet-chip desktop-only">{shortKey(publicKey)}</span>
            {statusIndicator}
            <button
              type="button"
              className="text-button desktop-only"
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          </>
        ) : (
          <>
            {statusIndicator}
            <WalletMultiButton />
          </>
        )}

        {/* Mobile Dropdown Trigger */}
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

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div className="mobile-dropdown-menu">
          {publicKey && (
            <div className="mobile-dropdown-wallet">
              <span className="wallet-chip">{shortKey(publicKey)}</span>
            </div>
          )}

          <button
            type="button"
            className={`mobile-menu-item ${view === "ledger" ? "active" : ""}`}
            onClick={() => handleNavigate("ledger")}
          >
            Ledger
          </button>
          <button
            type="button"
            className={`mobile-menu-item ${view === "reserve" ? "active" : ""}`}
            onClick={() => handleNavigate("reserve")}
          >
            Reserve
          </button>
          <button
            type="button"
            className={`mobile-menu-item ${view === "sign" ? "active" : ""}`}
            onClick={() => handleNavigate("sign")}
          >
            Sign
          </button>
          <button
            type="button"
            className={`mobile-menu-item ${view === "merchant" ? "active" : ""}`}
            onClick={() => handleNavigate("merchant")}
          >
            Merchant
          </button>

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
            <button
              className="quiet-button"
              onClick={() =>
                document.getElementById("how-it-works")?.scrollIntoView({
                  behavior: "smooth",
                })
              }
            >
              How it works <span>↓</span>
            </button>
          </div>
          <div className="trust-line">
            <span className="online-indicator">● live on {CLUSTER}</span>
          </div>
        </div>
        <button
          className="scroll-cue"
          onClick={() =>
            document.getElementById("how-it-works")?.scrollIntoView({
              behavior: "smooth",
            })
          }
        >
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
        onToggleOnline={toggleOnline}
      />
      {offlineReady && (
        <div className="offline-ready" role="status">
          Offline payments ready on this device
        </div>
      )}

      {/* Smooth cross-fade transition */}
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
