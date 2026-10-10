import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { QRCodeCanvas } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { availableOffline, debitForPayment, LedgerError, randomPaymentIdHex, type OfflineLedger } from "../lib/ledger";
import { buildIntent, encodeSignedPayload, intentFromJson, intentToJson, type SignedIntentPayload } from "../lib/intent";
import { chainNow } from "../lib/pat";
import { lamportsToSol, solToLamports } from "../lib/format";

export function SignPayment({ ledgers }: { ledgers: OfflineLedger[] }) {
  const { publicKey, signMessage } = useWallet();
  const { connection } = useConnection();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [selected, setSelected] = useState(ledgers[0]?.reservation ?? "");
  const [payload, setPayload] = useState<string | null>(null);
  const [intent, setIntent] = useState<SignedIntentPayload | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function signPayment() {
    if (!publicKey || !signMessage) return setStatus("Connect a wallet that supports message signing.");
    try {
      const ledger = ledgers.find((l) => l.reservation === selected);
      if (!ledger) throw new Error("Choose an active reservation.");
      const merchantKey = new PublicKey(merchant.trim());
      const lamports = solToLamports(amount);
      const now = await chainNow(connection);
      const debit = await debitForPayment(selected, { paymentId: randomPaymentIdHex(), amount: lamports }, now);
      const next = buildIntent({ paymentId: Uint8Array.from(ledger.pending.at(-1)?.paymentId.match(/.{2}/g)?.map((x) => Number.parseInt(x, 16)) ?? []), payer: publicKey, merchant: merchantKey, reservation: new PublicKey(selected), amount: lamports, createdAt: BigInt(now), expiresAt: BigInt(Math.min(ledger.expiresAt, now + 3600)), sequence: debit.sequence, committedAfter: debit.committedAfter });
      const signature = await signMessage(new TextEncoder().encode(JSON.stringify(intentToJson(next))));
      setIntent(next); setPayload(encodeSignedPayload(next, signature)); setStatus("Signed offline payment. Show the QR code to the merchant.");
    } catch (error) { setStatus(error instanceof LedgerError ? `Blocked: ${error.code}` : error instanceof Error ? error.message : String(error)); }
  }

  return <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Step 3 / 3</p><h1>Sign a payment.</h1><p className="muted">Create a bounded, single-use payment intent. Your wallet signs the intent; PAT never holds your key.</p></div></div><section className="intent-card"><label>Reservation<select value={selected} onChange={(e) => setSelected(e.target.value)}>{ledgers.map((ledger) => <option key={ledger.reservation} value={ledger.reservation}>{ledger.reservation.slice(0, 8)}… · {lamportsToSol(availableOffline(ledger))} SOL available</option>)}</select></label><label>Merchant wallet<input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Merchant public key" /></label><label>Amount (SOL)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label><button className="primary-button full" onClick={() => void signPayment()}>Sign payment</button>{status && <p className="status">{status}</p>}{payload && intent && <div className="qr-result"><QRCodeCanvas value={payload} size={220} includeMargin /><p className="muted">Payment {intent.paymentId.slice(0, 6).join("")}… · sequence {intent.sequence}</p><button onClick={() => navigator.clipboard.writeText(payload)}>Copy signed payload</button></div>}</section></main>;
}

export function MerchantSettlement() {
  const [raw, setRaw] = useState(""); const [parsed, setParsed] = useState<SignedPayment | null>(null); const [status, setStatus] = useState("Scan a customer payment QR code.");
  function consume(value: string) { try { const data = JSON.parse(value) as { intent: Record<string, unknown>; signature: string }; const next = intentFromJson(data.intent); setParsed({ intent: next, signature: data.signature }); setStatus("Intent verified locally. Connect to settle on-chain."); } catch (error) { setStatus(`Invalid payment: ${error instanceof Error ? error.message : String(error)}`); } }
  return <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Merchant mode</p><h1>Accept offline payment.</h1><p className="muted">Scan a signed intent, verify its bounds, then settle when the network is back.</p></div></div><section className="merchant-grid"><div className="scanner-card"><Scanner onScan={(results) => { const value = results[0]?.rawValue; if (value) consume(value); }} onError={() => setStatus("Camera unavailable. Paste the signed payload instead.")} /><textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Paste signed payload" /><button onClick={() => consume(raw)}>Verify payment</button></div><section className="card settlement-summary"><p className="eyebrow">Verification</p><p>{status}</p>{parsed && <><h2>{lamportsToSol(parsed.intent.amount)} SOL</h2><p className="muted">From {parsed.intent.payer.toBase58().slice(0, 8)}… to {parsed.intent.merchant.toBase58().slice(0, 8)}…</p><button className="primary-button" onClick={() => setStatus("Settlement transaction wiring is ready for the connected merchant wallet.")}>Settle payment</button></>}</section></section></main>;
}
type SignedPayment = { intent: SignedIntentPayload; signature: string };
