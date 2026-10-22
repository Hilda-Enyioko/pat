import { useEffect, useRef, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { QRCodeCanvas } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { ChevronDown, QrCode, ScanLine } from "lucide-react";
import * as PricingCard from "@/components/ui/pricing-card";
import { cn } from "@/lib/utils";

import {
  availableOffline,
  addHistoryEntry,
  debitForPayment,
  nowAdjusted,
  rollbackPending,
  LedgerError,
  type OfflineLedger,
} from "../lib/ledger";
import {
  buildIntent,
  encodeSignedPayload,
  intentFromJson,
  serializeIntentSigningBytes,
  type SignedIntentPayload,
} from "../lib/intent";
import { buildSettleIx, mapProgramError } from "../lib/pat";
import { lamportsToSol, solToLamports, shortKey } from "../lib/format";
import { Field, inputClass } from "./site/Field";
import { PageHeading } from "./site/PageHeading";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";
import { InputError, notify, reportError } from "../lib/notify";

const LEDGER_MESSAGES: Partial<Record<string, string>> = {
  RESERVATION_EXPIRED: "This reservation is no longer active.",
  ZERO_AMOUNT: "Amount must be greater than zero.",
  OVER_PER_PAYMENT_CAP: "Amount exceeds the per-payment cap.",
  INSUFFICIENT_OFFLINE_BALANCE: "Amount exceeds your available offline balance.",
};

export function SignPayment({
  ledgers,
  lockedCount = 0,
}: {
  ledgers: OfflineLedger[];
  lockedCount?: number;
}) {
  const { publicKey, signMessage } = useWallet();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [memo, setMemo] = useState("");
  const [selected, setSelected] = useState(ledgers[0]?.reservation ?? "");
  const [payload, setPayload] = useState<string | null>(null);
  const [intent, setIntent] = useState<SignedIntentPayload | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    if (!ledgers.some((l) => l.reservation === selected)) {
      setSelected(ledgers[0]?.reservation ?? "");
    }
  }, [ledgers, selected]);

  async function signPayment() {
    let paymentId = "";
    try {
      if (!publicKey) throw new InputError("Connect your wallet first.");
      if (!signMessage) throw new Error("This wallet can't sign messages, which PAT needs to authorise offline payments. Try Phantom or Solflare.");

      const ledger = ledgers.find((l) => l.reservation === selected);
      if (!ledger) throw new InputError("Choose an active reservation.");

      let merchantKey: PublicKey;
      try {
        merchantKey = new PublicKey(merchant.trim());
      } catch {
        throw new InputError("The merchant wallet address isn't valid. Check it and try again.");
      }
      if (merchantKey.equals(publicKey)) throw new InputError("Merchant must be different from the payer.");

      let lamports: bigint;
      try {
        lamports = solToLamports(amount);
      } catch {
        throw new InputError("Enter the amount as a plain SOL number, like 0.25.");
      }
      if (lamports <= 0n) throw new InputError("Amount must be greater than zero.");
      if (lamports > BigInt(ledger.perPaymentCap)) throw new InputError("Amount exceeds the per-payment cap.");
      if (lamports > availableOffline(ledger)) throw new InputError("Amount exceeds your available offline balance.");

      const now = nowAdjusted(ledger);
      if (now >= ledger.expiresAt) throw new InputError("This reservation is no longer active.");

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
        throw new Error("Your wallet returned an invalid signature; the message may have been altered. Nothing was signed.");
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
      notify.success("Payment signed", "Show the QR code to the merchant.");
    } catch (error) {
      if (paymentId) await rollbackPending(paymentId);
      const ledgerMessage = error instanceof LedgerError ? LEDGER_MESSAGES[error.code] : undefined;
      reportError(ledgerMessage ? new InputError(ledgerMessage) : error, { title: "Couldn't sign this payment" });
    }
  }

  const handleCopy = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopySuccess(true);
      notify.success("Payload copied", undefined, { key: "copy" });
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      notify.warning("Couldn't copy", "Your browser blocked the clipboard. Use Download .pat instead.");
    }
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


  const hexShort = intent
    ? Array.from(intent.paymentId)
        .slice(0, 4)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : "";

  return (
    <main className="page">
      <PageHeading
        eyebrow="Step 3 / 3"
        lines={["Sign a", "payment."]}
        lede="No network needed. Your device clock is used, so keep it accurate."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <section className="rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void signPayment();
            }}
          >
            <Field id="reservationSelect" label="Reservation">
              <div className="relative">
                <select
                  id="reservationSelect"
                  className={cn(inputClass, "cursor-pointer appearance-none pr-12")}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {ledgers.length === 0 && (
                    <option value="">
                      {lockedCount > 0
                        ? "Restored reservations cannot sign here. Reserve on this device."
                        : "No active reservations found"}
                    </option>
                  )}
                  {ledgers.map((ledger) => (
                    <option key={ledger.reservation} value={ledger.reservation}>
                      {ledger.reservation.slice(0, 8)}… · {lamportsToSol(availableOffline(ledger))} SOL available
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2" aria-hidden="true" />
              </div>
            </Field>

            <Field id="merchantInput" label="Merchant wallet">
              <input
                id="merchantInput"
                className={cn(inputClass, "font-mono text-sm")}
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Merchant public key"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="amountInput" label="Amount (SOL)">
                <input
                  id="amountInput"
                  className={inputClass}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.01"
                />
              </Field>
              <Field id="memoInput" label="Memo (optional)">
                <input
                  id="memoInput"
                  className={inputClass}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Coffee, groceries, etc."
                />
              </Field>
            </div>

            <PillButton type="submit" size="lg" text="Sign payment" className="w-full" />

          </form>
        </section>

        {payload && intent ? (
          <section aria-label="Signed payment" className="flex flex-col items-center gap-5 rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Show to merchant</span>
              <span className="rounded-full bg-yellow px-2.5 py-0.5 text-[11px] font-semibold">SIGNED</span>
            </div>
            <div className="rounded-[18px] border border-ink/10 bg-white p-3">
              <QRCodeCanvas value={payload} size={260} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0f0f0e" className="block h-auto max-w-full" />
            </div>
            <p className="m-0 text-center font-display text-4xl font-black uppercase leading-none tracking-[-0.05em] [font-stretch:85%]">
              {lamportsToSol(intent.amount)} SOL
            </p>
            <p className="m-0 font-mono text-xs text-muted-foreground">
              Payment {hexShort}… · sequence {intent.sequence}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <PillButton type="button" size="sm" tone="light" text={copySuccess ? "Copied!" : "Copy payload"} onClick={() => void handleCopy()} />
              <PillButton type="button" size="sm" tone="light" text="Download .pat" onClick={handleDownload} />
            </div>
          </section>
        ) : (
          <section
            aria-label="Signed payment preview"
            className="grainy on-dark flex min-h-[420px] flex-col justify-between rounded-[22px] bg-card-dark p-6 text-white"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-white/60">Payment intent · 230 B</span>
            <QrCode className="mx-auto size-28 stroke-[1.2] text-white/85" aria-hidden="true" />
            <p className="m-0 max-w-xs text-sm leading-relaxed text-white/75">
              Your signed payment appears here as a QR code. Hand it to the merchant; they settle it when they&rsquo;re online.
            </p>
          </section>
        )}
      </div>
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
  // The scanner reports the same code many times a second; handle each code once.
  const lastScan = useRef<string | null>(null);

  function consume(value: string) {
    try {
      let data: { intent: Record<string, unknown>; signature: string };
      let next: SignedIntentPayload;
      let sig: Uint8Array;
      try {
        data = JSON.parse(value);
        next = intentFromJson(data.intent);
        sig = bs58.decode(data.signature);
      } catch {
        throw new InputError("That isn't a PAT payment. Scan the payer's QR code or paste the full payload.");
      }
      if (sig.length !== 64) throw new InputError("The payment's signature is the wrong length.");
      if (publicKey && !next.merchant.equals(publicKey)) {
        throw new InputError("This payment is addressed to a different merchant wallet.");
      }
      if (Number(next.expiresAt) < Math.floor(Date.now() / 1000)) {
        throw new InputError("This payment has expired. Ask the payer to sign a new one.");
      }
      if (
        !nacl.sign.detached.verify(
          serializeIntentSigningBytes(next),
          sig,
          next.payer.toBytes()
        )
      ) {
        throw new Error("The payer's signature doesn't match this payment. It may have been altered. Don't accept it.");
      }
      setParsed(next);
      setSignature(sig);
      setStatus("Signature valid. Settle online to confirm funds.");
      notify.success("Payment verified", `${lamportsToSol(next.amount)} SOL, signed by the payer.`, { key: "scan" });
    } catch (e) {
      setParsed(null);
      setSignature(null);
      setStatus("Scan or paste a signed payment.");
      if (e instanceof InputError) notify.error("Invalid payment", e.message, { key: "scan" });
      else reportError(e, { title: "Don't accept this payment" });
    }
  }

  async function settle() {
    if (!parsed || !signature) return;
    if (!publicKey) {
      notify.warning("Connect the merchant wallet", "Settling needs the wallet this payment is addressed to.");
      return;
    }
    setSettling(true);
    setStatus("Checking balance and preparing preflight logs…");

    try {
      // -------------------------------------------------------------------------
      // 1. Balance & Preflight Readiness
      // -------------------------------------------------------------------------
      const balance = await connection.getBalance(publicKey, "confirmed");
      console.group("[PAT Settlement] Preflight Context");
      console.log("Settler (Merchant):", publicKey.toBase58());
      console.log(`Settler Balance: ${balance / 1e9} SOL (${balance} lamports)`);
      console.log("Payer:", parsed.payer.toBase58());
      console.log("Reservation Account:", parsed.reservation.toBase58());
      console.log("Amount (Lamports):", parsed.amount.toString());
      console.log("Sequence:", parsed.sequence);
      console.log("Signature (base58):", bs58.encode(signature));
      console.groupEnd();

      if (balance === 0) {
        throw new Error(
          "Merchant wallet has 0 SOL. Request an airdrop on Devnet to pay the transaction fee."
        );
      }

      // -------------------------------------------------------------------------
      // 2. Build Instructions & Log Structure
      // -------------------------------------------------------------------------
      setStatus("Building settlement instructions…");
      const instructions = await buildSettleIx({
        settler: publicKey,
        intent: parsed,
        signature,
      });

      console.group("📋 [PAT Settlement] Instruction Breakdown");
      instructions.forEach((ix, index) => {
        console.log(`Instruction #${index + 1}: Program ID -> ${ix.programId.toBase58()}`);
        console.table(
          ix.keys.map((k) => ({
            pubkey: k.pubkey.toBase58(),
            isSigner: k.isSigner,
            isWritable: k.isWritable,
          }))
        );
      });
      console.groupEnd();

      // -------------------------------------------------------------------------
      // 3. Assemble Transaction
      // -------------------------------------------------------------------------
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({
        feePayer: publicKey,
        recentBlockhash: latest.blockhash,
      }).add(...instructions);

      // -------------------------------------------------------------------------
      // 4. Preflight Simulation & Diagnostic Logging
      // -------------------------------------------------------------------------
      setStatus("Simulating transaction on-chain…");
      const sim = await connection.simulateTransaction(transaction, undefined, true);

      console.group("🔬 [PAT Settlement] Simulation Result");
      console.log("Units Consumed:", sim.value.unitsConsumed);
      if (sim.value.logs && sim.value.logs.length > 0) {
        console.log("Execution Logs:");
        sim.value.logs.forEach((log) => console.log(`  > ${log}`));
      }
      console.groupEnd();

      if (sim.value.err) {
        const simError = new Error(
          `Simulation failed: ${JSON.stringify(sim.value.err)}. Check console for full program logs.`
        ) as Error & { logs?: string[] };
        simError.logs = sim.value.logs ?? undefined;
        throw simError;
      }

      // -------------------------------------------------------------------------
      // 5. Sign & broadcast through the wallet
      // -------------------------------------------------------------------------
      // sendTransaction lets the wallet sign and send in one step. Mobile wallets
      // (Mobile Wallet Adapter on Android, wallet in-app browsers) handle that far
      // more reliably than returning a signed transaction for the page to send,
      // which could come back without the merchant's signature.
      setStatus("Approve transaction in your wallet…");
      const tx = await sendTransaction(transaction, connection, {
        skipPreflight: true, // already simulated above
        preflightCommitment: "confirmed",
      });

      setStatus("Confirming on-chain…");
      console.log(`Broadcasted Tx Signature: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

      await connection.confirmTransaction(
        { signature: tx, ...latest },
        "confirmed"
      );

      // -------------------------------------------------------------------------
      // 6. Record Settled Entry
      // -------------------------------------------------------------------------
      const hexPaymentId = Array.from(parsed.paymentId)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // A. Record in Merchant Received History (Always available to the merchant)
      try {
        const receipt = {
          signature: tx,
          paymentId: hexPaymentId,
          reservation: parsed.reservation.toBase58(),
          payer: parsed.payer.toBase58(),
          merchant: publicKey.toBase58(),
          amount: parsed.amount.toString(),
          settledAt: Math.floor(Date.now() / 1000),
          memo: `Settled tx: ${tx.slice(0, 8)}…`,
        };

        const merchantKey = `pat:merchant_history:${publicKey.toBase58()}`;
        const existing = JSON.parse(localStorage.getItem(merchantKey) || "[]");
        localStorage.setItem(merchantKey, JSON.stringify([receipt, ...existing]));
      } catch (e) {
        console.warn("Failed saving to merchant receipts:", e);
      }

      // B. If this device ALSO happens to hold the payer's ledger (e.g., self-testing on one device):
      try {
        await addHistoryEntry(parsed.reservation.toBase58(), {
          paymentId: hexPaymentId,
          merchant: publicKey.toBase58(),
          amount: parsed.amount.toString(),
          createdAt: Number(parsed.createdAt),
          expiresAt: Number(parsed.expiresAt),
          sequence: parsed.sequence,
          memo: `Settled tx: ${tx.slice(0, 8)}…`,
          status: "SETTLED",
          payload: raw || undefined,
        });
      } catch (historyErr: any) {
        // If NO_LEDGER, it's expected on an independent merchant machine
        if (historyErr?.message !== "NO_LEDGER" && historyErr?.code !== "NO_LEDGER") {
          console.warn("Could not update local reservation ledger:", historyErr);
        }
      }

      setStatus(`Payment settled ✔  Tx: ${tx.slice(0, 8)}…`);
      notify.success("Payment settled", `${lamportsToSol(parsed.amount)} SOL confirmed on-chain. Tx ${tx.slice(0, 8)}…`);
    } catch (e: any) {
      console.group("🛑 [PAT Settlement] Detailed Error Diagnostics");
      console.error("Error Object:", e);

      if (e.logs || e.message?.includes("Transaction simulation failed")) {
        const logs = e.logs || (typeof e.getLogs === "function" ? await e.getLogs(connection) : null);
        if (logs) {
          console.error("Program Logs from caught error:\n", logs.join("\n"));
        }
      }
      console.groupEnd();

      setStatus("Signature valid. Settle online to confirm funds.");
      reportError(e, {
        title: "Settlement failed",
        message: mapProgramError(e),
        actions: [{ label: "Try again", onClick: () => void settle() }],
      });
    } finally {
      setSettling(false);
    }
  }

  const isValid = status.startsWith("Signature valid") || status.startsWith("Payment settled");

  const settled = status.startsWith("Payment settled");

  return (
    <main className="page">
      <PageHeading
        eyebrow="Merchant mode"
        lines={["Accept", "offline", "payment."]}
        lede="Verify the signature locally, then settle once you are back online."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="scanner-title" className="rounded-[22px] bg-white p-1.5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)]">
          <div className="grainy on-dark overflow-hidden rounded-[18px] bg-card-dark p-4 text-white">
            <h2 id="scanner-title" className="m-0 mb-3 flex items-center gap-2 text-sm font-medium text-white/80">
              <ScanLine className="size-4" aria-hidden="true" /> Camera scanner
            </h2>
            <div className="aspect-[4/3] overflow-hidden rounded-[14px] bg-black">
              <Scanner
                onScan={(r) => {
                  const value = r[0]?.rawValue;
                  if (!value || value === lastScan.current) return;
                  lastScan.current = value;
                  consume(value);
                }}
                onError={() =>
                  notify.warning("Camera unavailable", "Allow camera access, or paste the signed payload instead.", { key: "camera" })
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <Field id="payloadInput" label="Or paste payload JSON">
              <textarea
                id="payloadInput"
                className={cn(inputClass, "h-auto min-h-28 resize-y py-3 font-mono text-xs")}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder='{"intent": {...}, "signature": "..."}'
                aria-label="Signed payment payload"
                rows={4}
              />
            </Field>
            <PillButton type="button" tone="light" text="Verify payment" onClick={() => consume(raw)} className="w-full" />
          </div>
        </section>

        <PricingCard.Card className="max-w-none self-start rounded-[22px] bg-white p-1.5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)]">
          <PricingCard.Header
            className={cn("grainy mb-2 rounded-[18px] border-0 p-5", settled ? "bg-blue" : parsed ? "bg-yellow" : "bg-stone")}
            glassEffect={false}
          >
            <PricingCard.Plan className="mb-10">
              <PricingCard.PlanName className="text-ink">
                <span>Settlement</span>
              </PricingCard.PlanName>
              <PricingCard.Badge className="border-ink/25 bg-white/55 font-semibold text-ink">
                {settled ? "Confirmed" : parsed ? "Offline accepted" : "Awaiting payment"}
              </PricingCard.Badge>
            </PricingCard.Plan>
            <PricingCard.Price className="flex-wrap gap-x-3">
              <PricingCard.MainPrice className="font-display text-[clamp(52px,6vw,76px)] font-black leading-[0.85] tracking-[-0.05em] [font-stretch:85%]">
                {parsed ? lamportsToSol(parsed.amount) : <span className="text-ink/20">0.00</span>}
              </PricingCard.MainPrice>
              <PricingCard.Period className="text-ink/75">SOL payment amount</PricingCard.Period>
            </PricingCard.Price>
          </PricingCard.Header>

          <PricingCard.Body className="space-y-5">
            <StatusNote tone={isValid ? "success" : "neutral"}>{status}</StatusNote>

            {parsed ? (
              <>
                <PricingCard.List>
                  {[
                    ["Payer", shortKey(parsed.payer.toBase58())],
                    ["Merchant", shortKey(parsed.merchant.toBase58())],
                    ["Sequence", String(parsed.sequence)],
                  ].map(([label, value]) => (
                    <PricingCard.ListItem key={label} className="justify-between border-b border-ink/8 pb-3">
                      <span>{label}</span>
                      <span className="font-mono text-ink">{value}</span>
                    </PricingCard.ListItem>
                  ))}
                </PricingCard.List>
                <PillButton
                  type="button"
                  size="lg"
                  className="w-full"
                  disabled={settling}
                  onClick={() => void settle()}
                  text={settling ? "Settling…" : "Settle on-chain"}
                />
              </>
            ) : (
              <PricingCard.Description className="text-sm">
                Scan or paste a payload to preview settlement. Offline Accepted is your risk decision; Confirmed is the chain&rsquo;s.
              </PricingCard.Description>
            )}
          </PricingCard.Body>
        </PricingCard.Card>
      </div>
    </main>
  );
}

export type SignedPayment = { intent: SignedIntentPayload; signature: string };
