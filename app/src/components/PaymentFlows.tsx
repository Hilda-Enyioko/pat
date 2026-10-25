import { useEffect, useRef, useState } from "react";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
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
  getMerchantPending,
  removeMerchantPending,
  saveMerchantPending,
  saveMerchantReceipt,
  type HistoryEntry,
  type MerchantPending,
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
import { PaymentQr, PaymentQrDialog, type ShownPayment } from "./site/PaymentQr";
import { InputError, notify, reportError } from "../lib/notify";

const LEDGER_MESSAGES: Partial<Record<string, string>> = {
  RESERVATION_EXPIRED: "This reservation is no longer active.",
  ZERO_AMOUNT: "Amount must be greater than zero.",
  OVER_PER_PAYMENT_CAP: "Amount exceeds the per-payment cap.",
  INSUFFICIENT_OFFLINE_BALANCE: "Amount exceeds your available offline balance.",
};

const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const toShown = (h: HistoryEntry): ShownPayment => ({
  payload: h.payload!,
  amount: BigInt(h.amount),
  paymentId: h.paymentId,
  sequence: h.sequence,
});

export function SignPayment({
  ledgers,
  lockedCount = 0,
  pending = [],
  onSigned,
}: {
  ledgers: OfflineLedger[];
  lockedCount?: number;
  /** Signed payments not settled yet, from every reservation on this device. */
  pending?: HistoryEntry[];
  onSigned?: () => void;
}) {
  const { publicKey, signMessage } = useWallet();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [memo, setMemo] = useState("");
  const [selected, setSelected] = useState(ledgers[0]?.reservation ?? "");
  const [shown, setShown] = useState<ShownPayment | null>(null);
  const [reopened, setReopened] = useState<ShownPayment | null>(null);

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

      setShown({ payload: encoded, amount: lamports, paymentId, sequence: debit.sequence });
      onSigned?.();
      notify.success("Payment signed", "Show the QR code to the merchant.");
    } catch (error) {
      if (paymentId) await rollbackPending(paymentId);
      const ledgerMessage = error instanceof LedgerError ? LEDGER_MESSAGES[error.code] : undefined;
      reportError(ledgerMessage ? new InputError(ledgerMessage) : error, { title: "Couldn't sign this payment" });
    }
  }

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

        {shown ? (
          <section aria-label="Signed payment" className="flex flex-col items-center gap-5 rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Show to merchant</span>
              <span className="rounded-full bg-yellow px-2.5 py-0.5 text-[11px] font-semibold">SIGNED</span>
            </div>
            <PaymentQr payment={shown} />
          </section>
        ) : (
          <section
            aria-label="Signed payment preview"
            className="grainy on-dark flex min-h-105 flex-col justify-between rounded-[22px] bg-card-dark p-6 text-white"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-white/60">Payment intent · 230 B</span>
            <QrCode className="mx-auto size-28 stroke-[1.2] text-white/85" aria-hidden="true" />
            <p className="m-0 max-w-xs text-sm leading-relaxed text-white/75">
              Your signed payment appears here as a QR code. Hand it to the merchant; they settle it when they&rsquo;re online.
            </p>
          </section>
        )}
      </div>

      {pending.length > 0 && (
        <section aria-labelledby="pending-title" className="mt-6 rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
          <h2 id="pending-title" className="m-0 mb-1 text-lg font-semibold">Waiting to settle</h2>
          <p className="m-0 mb-4 text-sm text-muted-foreground">
            Signed but not on-chain yet. Show the QR again if the merchant didn&rsquo;t settle it.
          </p>
          <PendingList
            items={pending.map((h) => ({
              id: h.paymentId,
              amount: h.amount,
              detail: `${when(h.createdAt)} · to ${shortKey(h.merchant)}${h.memo ? ` · ${h.memo}` : ""}`,
              action: "Show QR",
              onOpen: () => setReopened(toShown(h)),
            }))}
          />
        </section>
      )}
      <PaymentQrDialog payment={reopened} onClose={() => setReopened(null)} />
    </main>
  );
}

function PendingList({
  items,
}: {
  items: { id: string; amount: string; detail: string; action: string; disabled?: boolean; onOpen: () => void }[];
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-4 rounded-[14px] border border-ink/8 px-4 py-3">
          <span className="min-w-0">
            <span className="block font-mono text-sm font-semibold">{lamportsToSol(BigInt(item.amount))} SOL</span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{item.detail}</span>
          </span>
          <PillButton type="button" size="sm" tone="light" text={item.action} disabled={item.disabled} onClick={item.onOpen} />
        </li>
      ))}
    </ul>
  );
}

export function MerchantSettlement() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState("Scan or paste a signed payment.");
  const [parsed, setParsed] = useState<SignedIntentPayload | null>(null);
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  // The payload exactly as verified, whether it was scanned or pasted.
  const [verified, setVerified] = useState("");
  const [settling, setSettling] = useState(false);
  // Verified payments still to settle, kept on this device so none are lost to a refresh.
  const [pending, setPending] = useState<MerchantPending[]>(getMerchantPending);
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
      if (
        !nacl.sign.detached.verify(
          serializeIntentSigningBytes(next),
          sig,
          next.payer.toBytes()
        )
      ) {
        throw new Error("The payer's signature doesn't match this payment. It may have been altered. Don't accept it.");
      }
      const paymentId = hexOf(next.paymentId);
      setParsed(next);
      setSignature(sig);
      setVerified(value);
      setPending(
        saveMerchantPending({
          paymentId,
          payload: value,
          amount: next.amount.toString(),
          payer: next.payer.toBase58(),
          merchant: next.merchant.toBase58(),
          verifiedAt: Math.floor(Date.now() / 1000),
        }),
      );
      // The chain accepts a payment until the reservation's settle window closes, so an
      // old intent can still settle; the simulation reports it if the window has closed.
      const stale = Number(next.expiresAt) < Math.floor(Date.now() / 1000);
      setStatus(
        stale
          ? "Signature valid, signed over an hour ago. It settles if the payer's settle window is still open."
          : "Signature valid. Settle online to confirm funds.",
      );
      if (publicKey && !next.merchant.equals(publicKey)) {
        notify.warning(
          "Paid to another wallet",
          `This payment pays ${shortKey(next.merchant.toBase58())}, not the connected wallet. You can still settle it; the funds go to ${shortKey(next.merchant.toBase58())}.`,
          { key: "scan" },
        );
      } else {
        notify.success("Payment verified", `${lamportsToSol(next.amount)} SOL, signed by the payer.`, { key: "scan" });
      }
    } catch (e) {
      setParsed(null);
      setSignature(null);
      setVerified("");
      setStatus("Scan or paste a signed payment.");
      if (e instanceof InputError) notify.error("Invalid payment", e.message, { key: "scan" });
      else reportError(e, { title: "Don't accept this payment" });
    }
  }

  async function settle() {
    if (!parsed || !signature) return;
    if (!publicKey) {
      notify.warning("Connect a wallet", "Settling needs a wallet with a little SOL for the fee. The funds go to the merchant either way.");
      return;
    }

    setSettling(true);
    setStatus("Checking balance and preparing preflight logs…");
    const hexPaymentId = hexOf(parsed.paymentId);

    try {
      // -----------------------------------------------------------------------
      // 1. Balance & Preflight Readiness
      // -----------------------------------------------------------------------
      const balance = await connection.getBalance(publicKey, "confirmed");
      console.group("[PAT Settlement] Preflight Context");
      console.log("Settler:", publicKey.toBase58());
      console.log(`Settler Balance: ${balance / 1e9} SOL (${balance} lamports)`);
      console.log("Payer:", parsed.payer.toBase58());
      console.log("Merchant:", parsed.merchant.toBase58());
      console.log("Reservation Account:", parsed.reservation.toBase58());
      console.log("Amount (Lamports):", parsed.amount.toString());
      console.log("Sequence:", parsed.sequence);
      console.log("Signature (base58):", bs58.encode(signature));
      console.groupEnd();

      if (balance === 0) {
        throw new Error(
          "The connected wallet has 0 SOL. Request an airdrop on Devnet to pay the transaction fee."
        );
      }

      // -----------------------------------------------------------------------
      // 2. Build Instructions & Log Structure
      // -----------------------------------------------------------------------
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

      // -----------------------------------------------------------------------
      // 3. Assemble Transaction (a factory, so simulation never touches the
      //    instance that goes to the wallet)
      // -----------------------------------------------------------------------
      // A versioned transaction, not a legacy one: on Android the Mobile Wallet
      // Adapter serializes the transaction before the wallet signs it, and a
      // legacy Transaction refuses to serialize unsigned ("Missing signature for
      // public key"). Versioned transactions serialize without that check.
      const latest = await connection.getLatestBlockhash("confirmed");
      const buildTx = () =>
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: publicKey,
            recentBlockhash: latest.blockhash,
            instructions,
          }).compileToV0Message()
        );

      // -----------------------------------------------------------------------
      // 4. Preflight Simulation & Diagnostic Logging (on a throwaway instance)
      // -----------------------------------------------------------------------
      setStatus("Simulating transaction on-chain…");
      const sim = await connection.simulateTransaction(buildTx(), { sigVerify: false, commitment: "confirmed" });

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

      // -----------------------------------------------------------------------
      // 5. Sign & broadcast through the wallet
      // -----------------------------------------------------------------------
      // sendTransaction lets the wallet sign and send in one step, which mobile
      // wallets (Mobile Wallet Adapter, in-app browsers) handle most reliably.
      setStatus("Approve transaction in your wallet…");
      const tx = await sendTransaction(buildTx(), connection, {
        skipPreflight: true, // already simulated above
        preflightCommitment: "confirmed",
      });

      setStatus("Confirming on-chain…");
      console.log(`Broadcasted Tx Signature: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

      await connection.confirmTransaction(
        { signature: tx, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        "confirmed"
      );

      // -----------------------------------------------------------------------
      // 6. Record Settled Entry
      // -----------------------------------------------------------------------
      setPending(removeMerchantPending(hexPaymentId));

      // A. Record in Merchant Received History (always available to the merchant)
      try {
        saveMerchantReceipt({
          signature: tx,
          paymentId: hexPaymentId,
          reservation: parsed.reservation.toBase58(),
          payer: parsed.payer.toBase58(),
          merchant: parsed.merchant.toBase58(),
          amount: parsed.amount.toString(),
          settledAt: Math.floor(Date.now() / 1000),
          memo: `Settled tx: ${tx.slice(0, 8)}…`,
        });
      } catch (e) {
        console.warn("Failed saving to merchant receipts:", e);
      }

      // B. If this device ALSO holds the payer's ledger (e.g. self-testing on one device):
      try {
        await addHistoryEntry(parsed.reservation.toBase58(), {
          paymentId: hexPaymentId,
          merchant: parsed.merchant.toBase58(),
          amount: parsed.amount.toString(),
          createdAt: Number(parsed.createdAt),
          expiresAt: Number(parsed.expiresAt),
          sequence: parsed.sequence,
          memo: `Settled tx: ${tx.slice(0, 8)}…`,
          status: "SETTLED",
          payload: verified || undefined,
        });
      } catch (historyErr: any) {
        // NO_LEDGER is expected on an independent merchant machine
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

      const reason = mapProgramError(e);
      if (reason === "Already settled") {
        // Settled earlier (from this device or another); nothing left to do.
        setPending(removeMerchantPending(hexPaymentId));
        setStatus("Payment settled ✔  Already on-chain.");
        notify.info("Already settled", "This payment is already on-chain.", { key: "scan" });
        return;
      }

      setStatus("Signature valid. Settle online to confirm funds.");

      reportError(e, {
        title: "Settlement failed",
        message: reason,
        actions: [{ label: "Try again", onClick: () => void settle() }],
      });
    } finally {
      setSettling(false);
    }
  }

  const isValid = status.startsWith("Signature valid") || status.startsWith("Payment settled");

  const settled = status.startsWith("Payment settled");
  const openId = parsed ? hexOf(parsed.paymentId) : null;
  const waiting = pending.filter((p) => p.paymentId !== openId);

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
            <div className="aspect-4/3 overflow-hidden rounded-[14px] bg-black">
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
              <PricingCard.MainPrice className="font-display text-[clamp(52px,6vw,76px)] font-black leading-[0.85] tracking-tighter font-stretch-85%">
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
                  disabled={settling || settled}
                  onClick={() => void settle()}
                  text={settling ? "Settling…" : settled ? "Settled" : "Settle on-chain"}
                />
                {publicKey && !settled && (
                  <p className="m-0 text-center text-xs text-muted-foreground">
                    Settling as <span className="font-mono text-ink">{shortKey(publicKey.toBase58())}</span>, which pays the fee.
                  </p>
                )}
              </>
            ) : (
              <PricingCard.Description className="text-sm">
                Scan or paste a payload to preview settlement. Offline Accepted is your risk decision; Confirmed is the chain&rsquo;s.
              </PricingCard.Description>
            )}
          </PricingCard.Body>
        </PricingCard.Card>
      </div>

      {waiting.length > 0 && (
        <section aria-labelledby="waiting-title" className="mt-6 rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
          <h2 id="waiting-title" className="m-0 mb-1 text-lg font-semibold">Waiting to settle</h2>
          <p className="m-0 mb-4 text-sm text-muted-foreground">
            Payments you verified on this device but haven&rsquo;t settled yet. Open one to settle it.
          </p>
          <PendingList
            items={waiting.map((p) => ({
              id: p.paymentId,
              amount: p.amount,
              detail: `${when(p.verifiedAt)} · from ${shortKey(p.payer)}`,
              action: "Open",
              disabled: settling,
              onOpen: () => {
                consume(p.payload);
                window.scrollTo({ top: 0, behavior: "smooth" });
              },
            }))}
          />
        </section>
      )}
    </main>
  );
}

export type SignedPayment = { intent: SignedIntentPayload; signature: string };
