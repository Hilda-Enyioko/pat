import { useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { QRCodeCanvas } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  availableOffline,
  addHistoryEntry,
  debitForPayment,
  nowAdjusted,
  rollbackPending,
  type OfflineLedger,
} from "../lib/ledger";
import {
  buildIntent,
  encodeSignedPayload,
  intentFromJson,
  serializeIntentSigningBytes,
  type SignedIntentPayload,
} from "../lib/intent";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { buildSettleIx, mapProgramError } from "../lib/pat";
import { lamportsToSol, solToLamports, shortKey } from "../lib/format";

export function SignPayment({ ledgers }: { ledgers: OfflineLedger[] }) {
  const { publicKey, signMessage } = useWallet();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [memo, setMemo] = useState("");
  const [selected, setSelected] = useState(ledgers[0]?.reservation ?? "");
  const [payload, setPayload] = useState<string | null>(null);
  const [intent, setIntent] = useState<SignedIntentPayload | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  async function signPayment() {
    let paymentId = "";
    try {
      if (!publicKey) throw new Error("Connect your wallet first.");
      if (!signMessage) throw new Error("This wallet does not support signMessage.");

      const ledger = ledgers.find((l) => l.reservation === selected);
      if (!ledger) throw new Error("Choose an active reservation.");

      const merchantKey = new PublicKey(merchant.trim());
      if (merchantKey.equals(publicKey)) throw new Error("Merchant must be different from the payer.");

      const lamports = solToLamports(amount);
      if (lamports <= 0n) throw new Error("Amount must be greater than zero.");
      if (lamports > BigInt(ledger.perPaymentCap)) throw new Error("Amount exceeds the per-payment cap.");
      if (lamports > availableOffline(ledger)) throw new Error("Amount exceeds available offline balance.");

      const now = nowAdjusted(ledger);
      if (now >= ledger.expiresAt) throw new Error("Reservation is no longer Active.");

      paymentId = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");

      const debit = await debitForPayment(selected, { paymentId, amount: lamports }, now);
      const createdAt = Math.max(
        now,
        Math.floor(ledger.history.find((h) => h.paymentId === paymentId)?.createdAt ?? 0),
        Math.floor(Date.now() / 1000) + (ledger.clockOffset ?? 0)
      );

      const next = buildIntent({
        paymentId: Uint8Array.from(paymentId.match(/.{2}/g)!, (x) => parseInt(x, 16)),
        payer: publicKey,
        merchant: merchantKey,
        reservation: new PublicKey(selected),
        amount: lamports,
        createdAt: BigInt(Math.min(createdAt, ledger.expiresAt)),
        expiresAt: BigInt(Math.min(createdAt + 3600, ledger.expiresAt)),
        sequence: debit.sequence,
        committedAfter: debit.committedAfter,
      });

      let signature: Uint8Array;
      try {
        signature = await signMessage(serializeIntentSigningBytes(next));
      } catch (e) {
        await rollbackPending(paymentId);
        throw e;
      }

      if (
        !nacl.sign.detached.verify(
          serializeIntentSigningBytes(next),
          signature,
          publicKey.toBytes()
        )
      ) {
        await rollbackPending(paymentId);
        throw new Error("Wallet returned an invalid signature; the message may have been altered.");
      }

      const encoded = encodeSignedPayload(next, signature);
      await addHistoryEntry(selected, {
        paymentId,
        merchant: merchantKey.toBase58(),
        amount: lamports.toString(),
        createdAt: Number(next.createdAt),
        expiresAt: Number(next.expiresAt),
        sequence: debit.sequence,
        memo: memo || undefined,
        status: "SIGNED",
        payload: encoded,
      });

      setIntent(next);
      setPayload(encoded);
      setStatus("Signed offline payment. Present the QR code to the merchant.");
    } catch (error) {
      if (paymentId) await rollbackPending(paymentId);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  const handleCopy = async () => {
    if (!payload) return;
    await navigator.clipboard.writeText(payload);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleDownload = () => {
    if (!payload || !intent) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const hexId = Array.from(intent.paymentId)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    a.download = `${hexId}.pat`;
    a.click();
  };

  const isErrorStatus = status?.startsWith("Connect") || status?.startsWith("Choose") || status?.startsWith("Amount") || status?.startsWith("Reservation") || status?.startsWith("Wallet returned");
  const isSuccessStatus = status?.startsWith("Signed offline payment");

  return (
    <main className="workspace page-shell">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Step 3 / 3</p>
          <h1>Sign a payment.</h1>
          <p className="muted">Your device clock is used; keep it accurate.</p>
        </div>
      </div>

      <section className="intent-card flow-card">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void signPayment();
          }}
        >
          <div className="field-group">
            <label htmlFor="reservationSelect" className="field-label">
              Reservation
            </label>
            <select
              id="reservationSelect"
              className="text-input select-input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {ledgers.length === 0 && (
                <option value="">No active reservations found</option>
              )}
              {ledgers.map((ledger) => (
                <option key={ledger.reservation} value={ledger.reservation}>
                  {ledger.reservation.slice(0, 8)}… · {lamportsToSol(availableOffline(ledger))} SOL available
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="merchantInput" className="field-label">
              Merchant wallet
            </label>
            <input
              id="merchantInput"
              className="text-input"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="Merchant public key"
            />
          </div>

          <div className="field-group">
            <label htmlFor="amountInput" className="field-label">
              Amount (SOL)
            </label>
            <input
              id="amountInput"
              className="text-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.01"
            />
          </div>

          <div className="field-group">
            <label htmlFor="memoInput" className="field-label">
              Memo (optional)
            </label>
            <input
              id="memoInput"
              className="text-input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Coffee, groceries, etc."
            />
          </div>

          <button type="submit" className="primary-button full-width">
            Sign payment
          </button>

          {status && (
            <p
              className={`status-message ${
                isErrorStatus
                  ? "status-error"
                  : isSuccessStatus
                  ? "status-success"
                  : ""
              }`}
            >
              {status}
            </p>
          )}

          {payload && intent && (
            <div className="qr-result">
              <div className="qr-frame">
                <QRCodeCanvas
                  value={payload}
                  size={220}
                  level="M"
                  includeMargin
                  bgColor="#ffffff"
                  fgColor="#060b18"
                />
              </div>
              <p className="muted mono-caption">
                Payment{" "}
                <span className="mono-accent">
                  {Array.from(intent.paymentId)
                    .slice(0, 4)
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("")}…
                </span>{" "}
                · sequence {intent.sequence}
              </p>
              <div className="action-row">
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => void handleCopy()}
                >
                  {copySuccess ? "Copied!" : "Copy payload"}
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={handleDownload}
                >
                  Download .pat
                </button>
              </div>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

export function MerchantSettlement() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState("Scan or paste a signed payment.");
  const [parsed, setParsed] = useState<SignedIntentPayload | null>(null);
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  const [settling, setSettling] = useState(false);

  function consume(value: string) {
    try {
      const data = JSON.parse(value) as { intent: Record<string, unknown>; signature: string };
      const next = intentFromJson(data.intent);
      const sig = bs58.decode(data.signature);
      if (sig.length !== 64) throw new Error("Invalid signature length.");
      if (publicKey && !next.merchant.equals(publicKey)) throw new Error("Merchant mismatch.");
      if (Number(next.expiresAt) < Math.floor(Date.now() / 1000)) throw new Error("Payment expired.");
      if (
        !nacl.sign.detached.verify(
          serializeIntentSigningBytes(next),
          sig,
          next.payer.toBytes()
        )
      ) {
        throw new Error("Signature verification failed.");
      }
      setParsed(next);
      setSignature(sig);
      setStatus("Signature valid. Settle online to confirm funds.");
    } catch (e) {
      setParsed(null);
      setSignature(null);
      setStatus(`Invalid payment: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function settle() {
    if (!parsed || !signature) return;
    if (!publicKey) {
      setStatus("Connect the merchant wallet to settle.");
      return;
    }
    setSettling(true);
    setStatus("Submitting settlement…");
    try {
      const instructions = await buildSettleIx({ settler: publicKey, intent: parsed, signature });
      const transaction = new Transaction().add(...instructions);
      const latest = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = latest.blockhash;
      transaction.feePayer = publicKey;
      const tx = await sendTransaction(transaction, connection);
      await connection.confirmTransaction({ signature: tx, ...latest }, "confirmed");
      setStatus(`Payment settled. Transaction ${tx.slice(0, 8)}…`);
    } catch (e) {
      setStatus(mapProgramError(e));
    } finally {
      setSettling(false);
    }
  }

  const isError = status.startsWith("Invalid") || status.startsWith("Camera unavailable");
  const isValid = status.startsWith("Signature valid") || status.startsWith("Payment settled");

  return (
    <main className="workspace page-shell">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Merchant mode</p>
          <h1>Accept offline payment.</h1>
          <p className="muted">Verify locally, then settle once you are back online.</p>
        </div>
      </div>

      <div className="merchant-grid">
        <section className="scanner-card">
          <header className="card-header">
            <h3>Camera scanner</h3>
          </header>
          <div className="scanner-viewport">
            <Scanner
              onScan={(r) => {
                if (r[0]?.rawValue) consume(r[0].rawValue);
              }}
              onError={() =>
                setStatus("Camera unavailable. Paste the signed payload instead.")
              }
            />
          </div>

          <div className="field-group" style={{ marginTop: "16px" }}>
            <label htmlFor="payloadInput" className="field-label">
              Or paste payload JSON
            </label>
            <textarea
              id="payloadInput"
              className="text-input textarea-input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder='{"intent": {...}, "signature": "..."}'
              aria-label="Signed payment payload"
              rows={4}
            />
          </div>

          <button
            type="button"
            className="quiet-button full-width"
            onClick={() => consume(raw)}
            style={{ marginTop: "12px" }}
          >
            Verify payment
          </button>
        </section>

        <section className="card settlement-summary">
          <header className="card-header">
            <h3>Settlement status</h3>
            {parsed && <span className="pill status-signed">Verified</span>}
          </header>

          <p
            className={`status-message ${
              isError ? "status-error" : isValid ? "status-success" : ""
            }`}
          >
            {status}
          </p>

          {parsed ? (
            <div className="verified-details">
              <div className="balance-display" style={{ margin: "16px 0" }}>
                <div className="balance-amount">
                  {lamportsToSol(parsed.amount)} <span>SOL</span>
                </div>
                <div className="balance-label">payment amount</div>
              </div>

              <div className="ledger-metrics-table-wrapper">
                <table className="ledger-table">
                  <tbody>
                    <tr>
                      <td>Payer</td>
                      <td className="align-right mono-accent">
                        {shortKey(parsed.payer.toBase58())}
                      </td>
                    </tr>
                    <tr>
                      <td>Merchant</td>
                      <td className="align-right mono-accent">
                        {shortKey(parsed.merchant.toBase58())}
                      </td>
                    </tr>
                    <tr>
                      <td>Sequence</td>
                      <td className="align-right mono-accent">
                        {parsed.sequence}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                className="primary-button full-width"
                disabled={settling}
                onClick={() => void settle()}
              >
                {settling ? "Settling…" : "Settle payment on-chain"}
              </button>
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: "16px", padding: "40px 16px" }}>
              <p className="muted" style={{ margin: 0 }}>
                Scan or paste a payload to preview settlement options.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export type SignedPayment = { intent: SignedIntentPayload; signature: string };
