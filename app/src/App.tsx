import "./App.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Providers } from "./components/Providers";
import { ReserveForm } from "./components/ReserveForm";
import { LedgerPanel } from "./components/LedgerPanel";
import { listLedgers, type OfflineLedger, debitForPayment, randomPaymentIdHex, LedgerError } from "./lib/ledger";
import { lamportsToSol, solToLamports, shortKey } from "./lib/format";
import { useOnline } from "./hooks/useOnline";

const logoUrl = "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Beige%20and%20Black%20Elegant%20Wedding%20Boutique%20Logo%20%282%29-rnXAc0f8amlVTv0SYzi0nUMWJ76Z6U.png";
type View = "landing" | "auth" | "connect" | "reserve" | "ledger";

function Arrow() { return <span aria-hidden="true">↗</span>; }

function Nav({ view, setView, onLogout, publicKey }: { view: View; setView: (v: View) => void; onLogout: () => void; publicKey: string | null }) {
  return <header className="site-nav">
    <button className="brand" onClick={() => setView(publicKey ? "ledger" : "landing")} aria-label="PAT home"><img src={logoUrl} alt="PAT" /><span>PAT</span></button>
    <nav className="nav-links" aria-label="Primary navigation">
      <button className={view === "reserve" ? "active" : ""} onClick={() => setView("reserve")}>Reserve funds</button>
      <button className={view === "ledger" ? "active" : ""} onClick={() => setView("ledger")}>Ledger</button>
      <button onClick={() => setView("connect")}>Sign payment</button>
    </nav>
    <div className="nav-actions">{publicKey ? <><span className="wallet-chip">{shortKey(publicKey)}</span><button className="text-button" onClick={onLogout}>Log out</button></> : <button className="text-button" onClick={() => setView("auth")}>Log in</button>}</div>
  </header>;
}

function Landing({ onStart }: { onStart: () => void }) {
  return <main className="landing page-shell">
    <div className="hero-orb orb-one" /><div className="hero-orb orb-two" />
    <section className="hero-copy">
      <p className="eyebrow"><span className="eyebrow-dot" /> Offline payments, secured on Solana</p>
      <h1>Reserve online.<br /><em>Pay offline.</em></h1>
      <p className="hero-lede">PAT turns a connected wallet into a bounded offline allowance. Sign a payment when the network disappears, then let the merchant settle when they reconnect.</p>
      <div className="hero-actions"><button className="primary-button" onClick={onStart}>Create your account <Arrow /></button><button className="quiet-button" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>How it works <span>↓</span></button></div>
      <div className="trust-line"><span>Built for the moments connectivity fails</span><span className="line" /><span className="online-indicator">● live on devnet</span></div>
    </section>
    <section className="hero-card" aria-label="PAT payment flow">
      <div className="card-glow" /><div className="flow-header"><span className="mini-label">PAT / LIVE RESERVATION</span><span className="status-dot">● active</span></div>
      <div className="balance">0.80 <small>SOL available offline</small></div>
      <div className="flow-bar"><span style={{ width: "68%" }} /></div>
      <div className="flow-meta"><span>0.20 SOL committed</span><span>1.00 SOL reserved</span></div>
      <div className="flow-steps"><div><b>01</b><span>Reserve funds</span><i>Online</i></div><div className="flow-connector" /><div><b>02</b><span>Sign intent</span><i>Offline</i></div><div className="flow-connector" /><div><b>03</b><span>Settle payment</span><i>Merchant online</i></div></div>
      <div className="card-footer"><span>Reservation ID</span><strong>8f3a…d921</strong><span className="verified">✓ verified</span></div>
    </section>
    <section id="how-it-works" className="feature-strip"><div><span>01</span><h2>Bounded by design</h2><p>Set a total allowance and per-payment cap before you go offline.</p></div><div><span>02</span><h2>Your keys, always</h2><p>Only your wallet can authorize a payment intent.</p></div><div><span>03</span><h2>Proof on-chain</h2><p>Merchants settle later. Confirmed payments stay verifiable.</p></div></section>
  </main>;
}

function Auth({ onContinue }: { onContinue: () => void }) {
  const [mode, setMode] = useState<"create" | "login">("create");
  return <main className="centered-page"><section className="auth-card"><div className="auth-mark"><img src={logoUrl} alt="PAT" /></div><p className="eyebrow">{mode === "create" ? "Create your PAT account" : "Welcome back"}</p><h1>{mode === "create" ? "Start paying beyond the signal." : "Continue to your wallet."}</h1><p className="muted">{mode === "create" ? "Your account keeps your experience organized. Your wallet keeps you in control." : "Log in to manage your reservations and offline ledger."}</p><div className="auth-tabs"><button className={mode === "create" ? "selected" : ""} onClick={() => setMode("create")}>Create account</button><button className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>Log in</button></div><label>Email address<input type="email" placeholder="you@example.com" /></label><label>Password<input type="password" placeholder="At least 8 characters" /></label><button className="primary-button full" onClick={onContinue}>{mode === "create" ? "Create account" : "Log in"} <Arrow /></button><p className="tiny-copy">By continuing, you agree to PAT&apos;s self-custody terms.</p></section></main>;
}

function Connect({ onConnected }: { onConnected: () => void }) {
  const { publicKey } = useWallet();
  return <main className="centered-page"><section className="connect-card"><div className="step-count">STEP 02 / 03</div><h1>Connect your wallet.</h1><p className="muted">PAT never takes custody of your funds. Connect the wallet you&apos;ll use to reserve an offline allowance.</p><div className="wallet-panel"><div className="wallet-icon">◎</div><div><strong>{publicKey ? "Wallet connected" : "Your Solana wallet"}</strong><span>{publicKey ? shortKey(publicKey.toBase58()) : "Phantom, Solflare, or another adapter"}</span></div><WalletMultiButton /></div>{publicKey && <button className="primary-button full" onClick={onConnected}>Continue to reserve <Arrow /></button>}<div className="security-note"><span>⌁</span><p>Non-custodial by default. PAT only signs instructions you approve.</p></div></section></main>;
}

function SignIntent({ ledgers, onChange }: { ledgers: OfflineLedger[]; onChange: () => void }) {
  const { publicKey } = useWallet(); const [selected, setSelected] = useState(ledgers[0]?.reservation ?? ""); const [amount, setAmount] = useState("0.02"); const [message, setMessage] = useState<string | null>(null);
  const ledger = useMemo(() => ledgers.find((item) => item.reservation === selected) ?? ledgers[0], [ledgers, selected]);
  async function sign() { if (!ledger || !publicKey) return; try { await debitForPayment(ledger.reservation, { paymentId: randomPaymentIdHex(), amount: solToLamports(amount) }, Math.floor(Date.now() / 1000)); setMessage("Intent signed and added to your offline ledger."); onChange(); } catch (error) { setMessage(error instanceof LedgerError ? `Signing blocked: ${error.code}` : String(error)); } }
  return <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Offline authorization</p><h1>Sign a payment intent.</h1><p className="muted">Create a signed authorization now. Hand it to a merchant later, even without a connection.</p></div><span className="offline-badge">Works offline</span></div><section className="intent-card">{ledger ? <><label>Reservation<select value={ledger.reservation} onChange={(e) => setSelected(e.target.value)}>{ledgers.map((item) => <option key={item.reservation} value={item.reservation}>{shortKey(item.reservation)} · {lamportsToSol(BigInt(item.capacity))} SOL capacity</option>)}</select></label><label>Payment amount (SOL)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><div className="intent-preview"><span>Available to sign</span><strong>{lamportsToSol(BigInt(ledger.capacity) - BigInt(ledger.committedOnChain))} SOL</strong><span>Merchant receives the signed intent and settles it online.</span></div><button className="primary-button full" onClick={sign} disabled={!publicKey}>Sign payment intent <Arrow /></button>{message && <p className="status-message">{message}</p>}</> : <div className="empty-state"><h2>No active reservation yet</h2><p>Create a reservation before signing an offline payment.</p></div>}</section></main>;
}

function Workspace({ view, setView, ledgers, reload, online }: { view: View; setView: (v: View) => void; ledgers: OfflineLedger[]; reload: () => void; online: boolean }) {
  if (view === "reserve") return <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Step 03 / 03</p><h1>Reserve your offline funds.</h1><p className="muted">Lock a bounded allowance while connected. Unspent funds return after the settle window.</p></div><span className="online-badge">● {online ? "Online" : "Offline"}</span></div><ReserveForm onCreated={reload} /></main>;
  if (view === "connect") return <SignIntent ledgers={ledgers} onChange={reload} />;
  return <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Your offline ledger</p><h1>Know what you can spend.</h1><p className="muted">Your ledger is persisted on this device and fails closed when it cannot verify your allowance.</p></div><button className="primary-button" onClick={() => setView("reserve")}>Reserve funds <Arrow /></button></div>{ledgers.length === 0 ? <div className="empty-state"><h2>Your ledger is waiting.</h2><p>Connect a wallet and create your first reservation to see your available offline balance here.</p><button className="primary-button" onClick={() => setView("reserve")}>Create reservation <Arrow /></button></div> : ledgers.map((ledger) => <div key={ledger.reservation}><LedgerPanel ledger={ledger} online={online} onChange={reload} /></div>)}</main>;
}

function AppContent() {
  const { publicKey, disconnect } = useWallet(); const online = useOnline(); const [view, setView] = useState<View>("landing"); const [ledgers, setLedgers] = useState<OfflineLedger[]>([]);
  const reload = useCallback(async () => setLedgers(publicKey ? await listLedgers(publicKey.toBase58()) : []), [publicKey]); useEffect(() => { void reload(); }, [reload]);
  const logout = () => { void disconnect(); setView("landing"); };
  return <div className="app-shell"><Nav view={view} setView={setView} onLogout={logout} publicKey={publicKey?.toBase58() ?? null} />{view === "landing" && !publicKey ? <Landing onStart={() => setView("auth")} /> : view === "auth" ? <Auth onContinue={() => setView("connect")} /> : view === "connect" && !publicKey ? <Connect onConnected={() => setView("reserve")} /> : <Workspace view={view} setView={setView} ledgers={ledgers} reload={reload} online={online} />}</div>;
}

export default function App() { return <Providers><AppContent /></Providers>; }

export { logoUrl };

// PAT logo: a glossy cobalt-blue, three-pointed mark with three matching blue spheres on a deep navy background.
