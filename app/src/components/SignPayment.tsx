import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { addHistoryEntry, availableOffline, debitForPayment, nowAdjusted, rollbackPending, type OfflineLedger } from "../lib/ledger";
import { buildIntent, intentToPayload, serializeIntentSigningBytes, type SignedIntentPayload } from "../lib/intent";
import { solToLamports, shortKey } from "../lib/format";

export function SignPayment({ ledgers, onChange }: { ledgers: OfflineLedger[]; onChange: () => void }) {
  const { publicKey, signMessage } = useWallet();
  const [reservation, setReservation] = useState(ledgers[0]?.reservation ?? "");
  const [merchant, setMerchant] = useState(""); const [amount, setAmount] = useState(""); const [memo, setMemo] = useState("");
  const [error, setError] = useState(""); const [payload, setPayload] = useState<SignedIntentPayload | null>(null); const ledger = ledgers.find((l) => l.reservation === reservation);
  async function sign() {
    setError(""); setPayload(null);
    if (!publicKey) return setError("Connect your wallet before signing."); if (!signMessage) return setError("This wallet does not support message signing."); if (!ledger) return setError("Choose a reservation.");
    let merchantKey: PublicKey; try { merchantKey = new PublicKey(merchant); } catch { return setError("Enter a valid merchant public key."); }
    if (merchantKey.equals(publicKey)) return setError("Merchant must be different from the payer.");
    let lamports: bigint; try { lamports = solToLamports(amount); } catch { return setError("Enter a valid SOL amount greater than zero."); }
    if (lamports <= 0n) return setError("Amount must be greater than zero."); if (lamports > BigInt(ledger.perPaymentCap)) return setError("Amount exceeds this reservation's per-payment cap."); if (lamports > availableOffline(ledger)) return setError("Amount exceeds your available offline balance."); if (nowAdjusted(ledger) >= ledger.expiresAt) return setError("This reservation is no longer active.");
    const paymentId = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""); const now = nowAdjusted(ledger); const expires = Math.min(now + 3600, ledger.expiresAt);
    let hold: { sequence: number; committedAfter: bigint }; try { hold = await debitForPayment(ledger.reservation, { paymentId, amount: lamports }, now); const intent = buildIntent({ paymentId: Uint8Array.from(paymentId.match(/../g)!, (x) => parseInt(x, 16)), payer: publicKey, merchant: merchantKey, reservation: new PublicKey(ledger.reservation), amount: lamports, createdAt: BigInt(Math.max(now, Math.floor(ledger.syncedAt))), expiresAt: BigInt(expires), sequence: hold.sequence, committedAfter: hold.committedAfter }); const signature = await signMessage(serializeIntentSigningBytes(intent)); if (!nacl.sign.detached.verify(serializeIntentSigningBytes(intent), signature, publicKey.toBytes())) throw new Error("Wallet returned an invalid signature."); const next = intentToPayload(intent, signature); await addHistoryEntry(ledger.reservation, { paymentId, merchant: merchantKey.toBase58(), amount: lamports.toString(), createdAt: Number(intent.createdAt), expiresAt: Number(intent.expiresAt), sequence: intent.sequence, memo: memo || undefined, status: "SIGNED", payload: next }); setPayload(next); onChange(); } catch (e) { await rollbackPending(ledger.reservation, paymentId).catch(() => undefined); setError(e instanceof Error ? e.message : "Signing was rejected."); }
  }
  const encoded = payload ? JSON.stringify(payload, null, 2) : "";
  return <section className="sign-card"><div className="section-heading"><div><p className="eyebrow">Offline signing</p><h2>Sign a payment intent.</h2></div><span className="offline-badge">No network required</span></div><p className="muted">Your device clock is used; keep it accurate.</p><label>Reservation<select value={reservation} onChange={(e) => setReservation(e.target.value)}>{ledgers.map((l) => <option key={l.reservation} value={l.reservation}>{shortKey(l.reservation)} · {availableOffline(l).toString()} lamports available</option>)}</select></label><label>Merchant public key<input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Solana address" /></label><label>Amount in SOL<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.02" /></label><label>Local memo <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" /></label><button className="primary-button" onClick={() => void sign()}>Sign with wallet ↗</button>{error && <p className="error-text" role="alert">{error}</p>}{payload && <div className="payload-result"><p className="eyebrow">Signed and held locally</p><h3>Give this payload to the merchant.</h3><textarea readOnly value={encoded} aria-label="Signed payment payload" /><button className="quiet-button" onClick={() => void navigator.clipboard?.writeText(encoded)}>Copy payload</button><a className="quiet-button" download={`pat-${payload.intent.payment_id}.pat`} href={`data:application/json;charset=utf-8,${encodeURIComponent(encoded)}`}>Download .pat</a><p className="muted">Signature: {bs58.decode(payload.signature).length} bytes.</p></div>}</section>;
}
