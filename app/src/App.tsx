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
import nacl from "tweetnacl";
import bs58 from "bs58";

const logoUrl = "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Beige%20and%20Black%20Elegant%20Wedding%20Boutique%20Logo%20%282%29-rnXAc0f8amlVTv0SYzi0nUMWJ76Z6U.png";
type View = "landing" | "connect" | "reserve" | "ledger" | "sign" | "merchant";
const hashViews: View[] = ["reserve", "ledger", "sign", "merchant"];
function Arrow() { return <span aria-hidden="true">↗</span>; }

function WalletGate() {
  const { wallets } = useWallet();
  const installed = wallets.some((wallet) => wallet.readyState === "Installed") || Boolean(window.solflare?.isSolflare);
  return <div className="wallet-hints">{!installed && <p>No wallet extension detected in this browser tab. Install Solflare, enable it for this site (and for Incognito if applicable), then reload.</p>}<p>Set Solflare to Devnet: Settings &gt; Network &gt; Devnet.</p></div>;
}

function SignMessageSpike() {
  const { publicKey, signMessage } = useWallet();
  const [results, setResults] = useState<{ random?: string; invalid?: string; detail?: string }>({});
  async function test() {
    if (!publicKey) return setResults({ detail: "Connect a wallet first." });
    if (!signMessage) return setResults({ detail: "This connected wallet does not expose signMessage." });
    const random = crypto.getRandomValues(new Uint8Array(100));
    const invalid = new Uint8Array([0xff, 0xfe, 0x00, ...crypto.getRandomValues(new Uint8Array(97))]);
    const run = async (bytes: Uint8Array) => {
      const signature = await signMessage(bytes);
      const passed = nacl.sign.detached.verify(bytes, signature, publicKey.toBytes());
      return `${passed ? "PASS" : "FAIL"} (${bs58.encode(signature).slice(0, 12)}…)`;
    };
    try {
      const randomResult = await run(random);
      const invalidResult = await run(invalid);
      setResults({ random: randomResult, invalid: invalidResult });
    } catch (error) { setResults({ detail: error instanceof Error ? error.message : String(error) }); }
  }
  if (!import.meta.env.DEV) return null;
  return <section className="diagnostic-card"><div><p className="eyebrow">Development diagnostic</p><h2>Wallet signing spike</h2></div><button onClick={() => void test()}>Test signMessage</button>{results.detail && <p className="status">{results.detail}</p>}{results.random && <p>Random 100 bytes: <strong>{results.random}</strong></p>}{results.invalid && <p>Non-UTF-8 bytes: <strong>{results.invalid}</strong></p>}</section>;
}

function Nav({ view, setView, onDisconnect, publicKey, online }: { view: View; setView: (v: View) => void; onDisconnect: () => void; publicKey: string | null; online: boolean }) {
  return <header className="site-nav"><button className="brand" onClick={() => setView(publicKey ? "ledger" : "landing")} aria-label="PAT home"><img src={logoUrl} alt="PAT" /><span>PAT</span></button><nav className="nav-links" aria-label="Primary navigation"><button className={view === "reserve" ? "active" : ""} onClick={() => setView("reserve")}>Reserve funds</button><button className={view === "ledger" ? "active" : ""} onClick={() => setView("ledger")}>Ledger</button><button className={view === "sign" ? "active" : ""} onClick={() => setView("sign")}>Sign payment</button><button className={view === "merchant" ? "active" : ""} onClick={() => setView("merchant")}>Merchant</button></nav><div className="nav-actions">{publicKey ? <><span className="wallet-chip">{shortKey(publicKey)}</span><span className={online ? "online-indicator" : "offline-badge"}>{online ? "Online" : "Offline"}</span><button className="text-button" onClick={onDisconnect}>Disconnect</button></> : <WalletMultiButton />}</div></header>;
}

function Landing({ onStart }: { onStart: () => void }) { return <main className="landing page-shell"><div className="hero-orb orb-one" /><div className="hero-orb orb-two" /><section className="hero-copy"><p className="eyebrow"><span className="eyebrow-dot" /> Offline payments, secured on Solana</p><h1>Reserve online.<br /><em>Pay offline.</em></h1><p className="hero-lede">PAT turns a connected wallet into a bounded offline allowance. Sign a payment when the network disappears, then let the merchant settle when they reconnect.</p><div className="hero-actions"><button className="primary-button" onClick={onStart}>Connect wallet <Arrow /></button><button className="quiet-button" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>How it works <span>↓</span></button></div><div className="trust-line"><span>Built for the moments connectivity fails</span><span className="line" /><span className="online-indicator">● live on {CLUSTER}</span></div></section><section className="hero-card" aria-label="Illustrative PAT payment flow"><div className="card-glow" /><div className="flow-header"><span className="mini-label">PAT / EXAMPLE</span><span className="status-dot">● illustrative</span></div><div className="balance">0.80 <small>SOL available offline</small></div><div className="flow-bar"><span style={{ width: "68%" }} /></div><div className="flow-meta"><span>0.20 SOL committed</span><span>1.00 SOL reserved</span></div><div className="flow-steps"><div><b>01</b><span>Reserve funds</span><i>Online</i></div><div className="flow-connector" /><div><b>02</b><span>Sign intent</span><i>Offline</i></div><div className="flow-connector" /><div><b>03</b><span>Settle payment</span><i>Merchant online</i></div></div><div className="card-footer"><span>Example reservation</span><strong>8f3a…d921</strong><span className="verified">illustrative</span></div></section><section id="how-it-works" className="feature-strip"><div><span>01</span><h2>Bounded by design</h2><p>Set a total allowance and per-payment cap before you go offline.</p></div><div><span>02</span><h2>Your keys, always</h2><p>Only your wallet can authorize a payment intent.</p></div><div><span>03</span><h2>Proof on-chain</h2><p>Merchants settle later. Confirmed payments stay verifiable.</p></div></section></main>; }

function Connect() { return <main className="centered-page"><section className="connect-card"><div className="step-count">STEP 1 / 3</div><h1>Connect your wallet.</h1><p className="muted">PAT never takes custody of your funds. Connect the wallet you&apos;ll use to reserve an offline allowance.</p><div className="wallet-panel"><div className="wallet-icon">◎</div><div><strong>Your Solana wallet</strong><span>Solflare, Phantom, or another installed wallet</span></div><WalletMultiButton /></div><WalletGate /><div className="security-note"><span>⌁</span><p>Non-custodial by default. PAT only signs instructions you approve.</p></div></section><SignMessageSpike /></main>; }
function AppContent() {
  const { publicKey, disconnect } = useWallet(); const online = useOnline();
  const [view, setViewState] = useState<View>(() => { const candidate = window.location.hash.replace("#/", "") as View; return hashViews.includes(candidate) ? candidate : "landing"; });
  const [ledgers, setLedgers] = useState<OfflineLedger[]>([]);
  const setView = useCallback((next: View) => { setViewState(next); if (next === "landing" || next === "connect") window.history.replaceState(null, "", window.location.pathname); else window.history.replaceState(null, "", `#/${next}`); }, []);
  const reload = useCallback(async () => setLedgers(publicKey ? await listLedgers(publicKey.toBase58()) : []), [publicKey]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (!publicKey) { if (view !== "landing" && view !== "connect") setView("landing"); return; } if (view === "landing" || view === "connect") void reload().then(() => setViewState((current) => current)); }, [publicKey]);
  useEffect(() => { if (!publicKey) return; void listLedgers(publicKey.toBase58()).then((items) => { setLedgers(items); if (view === "landing" || view === "connect") setView(items.length ? "ledger" : "reserve"); }); }, [publicKey]);
  const guardedView = publicKey || view === "landing" || view === "connect" ? view : "connect";
  const disconnectWallet = () => { void disconnect(); setView("landing"); };
  let content: ReactNode;
  if (guardedView === "landing") content = <Landing onStart={() => setView("connect")} />;
  else if (guardedView === "connect") content = <Connect />;
  else if (guardedView === "reserve") content = <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Step 2 / 3</p><h1>Reserve your offline funds.</h1><p className="muted">Lock a bounded allowance while connected. Unspent funds return after the settle window.</p></div><span className="online-badge">● {online ? "Online" : "Offline"}</span></div><ReserveForm onCreated={() => { void reload(); setView("ledger"); }} /></main>;
  else if (guardedView === "ledger") content = <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Your offline ledger</p><h1>Know what you can spend.</h1><p className="muted">Your ledger is persisted on this device and fails closed when it cannot verify your allowance.</p></div><button className="primary-button" onClick={() => setView("reserve")}>Reserve funds <Arrow /></button></div>{ledgers.length === 0 ? <div className="empty-state"><h2>Your ledger is waiting.</h2><p>Create your first reservation to see your available offline balance here.</p><button className="primary-button" onClick={() => setView("reserve")}>Create reservation <Arrow /></button></div> : ledgers.map((ledger) => <LedgerPanel key={ledger.reservation} ledger={ledger} online={online} onChange={() => void reload()} />)}<SignMessageSpike /></main>;
  else if (guardedView === "sign") content = <SignPayment ledgers={ledgers} />;
  else content = <MerchantSettlement />;
  return <div className="app-shell"><Nav view={guardedView} setView={setView} onDisconnect={disconnectWallet} publicKey={publicKey?.toBase58() ?? null} online={online} />{content}<footer className="site-footer"><span>{CLUSTER} · {new URL(RPC_URL).host}</span></footer></div>;
}
export default function App() { return <Providers><AppContent /></Providers>; }
export { logoUrl };

declare global { interface Window { solflare?: { isSolflare?: boolean } } }
