import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { QRCodeCanvas } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { useWallet } from "@solana/wallet-adapter-react";
import { availableOffline, addHistoryEntry, debitForPayment, nowAdjusted, rollbackPending, type OfflineLedger } from "../lib/ledger";
import { buildIntent, encodeSignedPayload, intentFromJson, serializeIntentSigningBytes, type SignedIntentPayload } from "../lib/intent";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { lamportsToSol, solToLamports } from "../lib/format";

export function SignPayment({ ledgers }: { ledgers: OfflineLedger[] }) {
  const { publicKey, signMessage } = useWallet();
  const [merchant, setMerchant] = useState(""); const [amount, setAmount] = useState("0.01"); const [memo, setMemo] = useState("");
  const [selected, setSelected] = useState(ledgers[0]?.reservation ?? ""); const [payload, setPayload] = useState<string | null>(null); const [intent, setIntent] = useState<SignedIntentPayload | null>(null); const [status, setStatus] = useState<string | null>(null);
  async function signPayment() {
    let paymentId = "";
    try {
      if (!publicKey) throw new Error("Connect your wallet first."); if (!signMessage) throw new Error("This wallet does not support signMessage.");
      const ledger = ledgers.find((l) => l.reservation === selected); if (!ledger) throw new Error("Choose an active reservation.");
      const merchantKey = new PublicKey(merchant.trim()); if (merchantKey.equals(publicKey)) throw new Error("Merchant must be different from the payer.");
      const lamports = solToLamports(amount); if (lamports <= 0n) throw new Error("Amount must be greater than zero."); if (lamports > BigInt(ledger.perPaymentCap)) throw new Error("Amount exceeds the per-payment cap."); if (lamports > availableOffline(ledger)) throw new Error("Amount exceeds available offline balance.");
      const now = nowAdjusted(ledger); if (now >= ledger.expiresAt) throw new Error("Reservation is no longer Active.");
      paymentId = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      const debit = await debitForPayment(selected, { paymentId, amount: lamports }, now);
      const createdAt = Math.max(now, Math.floor((ledger.history.find((h) => h.paymentId === paymentId)?.createdAt ?? 0)), Math.floor(Date.now() / 1000) + (ledger.clockOffset ?? 0));
      const next = buildIntent({ paymentId: Uint8Array.from(paymentId.match(/.{2}/g)!, (x) => parseInt(x, 16)), payer: publicKey, merchant: merchantKey, reservation: new PublicKey(selected), amount: lamports, createdAt: BigInt(Math.min(createdAt, ledger.expiresAt)), expiresAt: BigInt(Math.min(createdAt + 3600, ledger.expiresAt)), sequence: debit.sequence, committedAfter: debit.committedAfter });
      let signature: Uint8Array; try { signature = await signMessage(serializeIntentSigningBytes(next)); } catch (e) { await rollbackPending(paymentId); throw e; }
      if (!nacl.sign.detached.verify(serializeIntentSigningBytes(next), signature, publicKey.toBytes())) { await rollbackPending(paymentId); throw new Error("Wallet returned an invalid signature; the message may have been altered."); }
      const encoded = encodeSignedPayload(next, signature); await addHistoryEntry(selected, { paymentId, merchant: merchantKey.toBase58(), amount: lamports.toString(), createdAt: Number(next.createdAt), expiresAt: Number(next.expiresAt), sequence: debit.sequence, memo: memo || undefined, status: "SIGNED", payload: encoded }); setIntent(next); setPayload(encoded); setStatus("Signed offline payment. Show the QR code to the merchant.");
    } catch (error) { if (paymentId) await rollbackPending(paymentId); setStatus(error instanceof Error ? error.message : String(error)); }
  }
  return <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Step 3 / 3</p><h1>Sign a payment.</h1><p className="muted">Your device clock is used; keep it accurate.</p></div></div><section className="intent-card"><label>Reservation<select value={selected} onChange={(e) => setSelected(e.target.value)}>{ledgers.map((ledger) => <option key={ledger.reservation} value={ledger.reservation}>{ledger.reservation.slice(0, 8)}… · {lamportsToSol(availableOffline(ledger))} SOL available</option>)}</select></label><label>Merchant wallet<input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Merchant public key" /></label><label>Amount (SOL)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label><label>Memo (optional)<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label><button className="primary-button full" onClick={() => void signPayment()}>Sign payment</button>{status && <p className="status">{status}</p>}{payload && intent && <div className="qr-result"><QRCodeCanvas value={payload} size={220} level="M" includeMargin /><p className="muted">Payment {Array.from(intent.paymentId).slice(0, 4).join("")}… · sequence {intent.sequence}</p><button onClick={() => void navigator.clipboard.writeText(payload)}>Copy payload</button><button onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([payload], { type: "application/json" })); a.download = `${Array.from(intent.paymentId).map((b) => b.toString(16).padStart(2, "0")).join("")}.pat`; a.click(); }}>Download .pat</button></div>}</section></main>;
}

export function MerchantSettlement() { const [raw, setRaw] = useState(""); const [status, setStatus] = useState("Scan or paste a signed payment."); const [parsed, setParsed] = useState<SignedIntentPayload | null>(null); const { publicKey } = useWallet(); function consume(value: string) { try { const data = JSON.parse(value) as { intent: Record<string, unknown>; signature: string }; const next = intentFromJson(data.intent); if (publicKey && !next.merchant.equals(publicKey)) throw new Error("Merchant mismatch."); if (Number(next.expiresAt) < Math.floor(Date.now() / 1000)) throw new Error("Payment expired."); if (!nacl.sign.detached.verify(serializeIntentSigningBytes(next), bs58.decode(data.signature), next.payer.toBytes())) throw new Error("Signature verification failed."); setParsed(next); setStatus("Signature valid. Funds are only confirmed once you settle online."); } catch (e) { setStatus(`Invalid payment: ${e instanceof Error ? e.message : String(e)}`); } } return <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Merchant mode</p><h1>Accept offline payment.</h1></div></div><section className="merchant-grid"><div className="scanner-card"><Scanner onScan={(r) => { if (r[0]?.rawValue) consume(r[0].rawValue); }} onError={() => setStatus("Camera unavailable. Paste the signed payload instead.")} /><textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Paste signed payload" /><button onClick={() => consume(raw)}>Verify payment</button></div><section className="card settlement-summary"><p>{status}</p>{parsed && <h2>{lamportsToSol(parsed.amount)} SOL</h2>}</section></section></main>; }
export type SignedPayment = { intent: SignedIntentPayload; signature: string };
