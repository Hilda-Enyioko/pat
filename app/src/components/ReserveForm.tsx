import { useEffect, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { CalendarDays, CheckCircle2, Coffee, Tent } from "lucide-react";
import * as PricingCard from "@/components/ui/pricing-card";
import { cn } from "@/lib/utils";
import { FAUCET_URL } from "@/lib/views";
import {
  buildReserveIx,
  chainNow,
  fetchReservation,
  PAYMENT_SPACE,
  RESERVATION_SPACE,
} from "../lib/pat";
import { initLedgerIfAbsent } from "../lib/ledger";
import { lamportsToSol, solToLamports } from "../lib/format";
import { Field, inputClass } from "./site/Field";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";

const PRESETS = [
  { name: "Pocket", icon: <Coffee />, capacity: "0.1", cap: "0.05", hours: "6", max: "5", description: "A coffee run with patchy signal." },
  { name: "Day pass", icon: <CalendarDays />, badge: "Popular", capacity: "1", cap: "0.5", hours: "24", max: "20", description: "A full day away from reliable data." },
  { name: "Weekend", icon: <Tent />, capacity: "3", cap: "1", hours: "72", max: "50", description: "Markets, festivals, road trips." },
];

export function ReserveForm({ onCreated }: { onCreated: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [capacitySol, setCapacitySol] = useState("1");
  const [capSol, setCapSol] = useState("0.5");
  const [hours, setHours] = useState("24");
  const [maxPayments, setMaxPayments] = useState("20");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [rents, setRents] = useState<{ reservation: bigint; payment: bigint } | null>(null);

  useEffect(() => {
    Promise.all([
      connection.getMinimumBalanceForRentExemption(RESERVATION_SPACE),
      connection.getMinimumBalanceForRentExemption(PAYMENT_SPACE),
    ])
      .then(([r, p]) => setRents({ reservation: BigInt(r), payment: BigInt(p) }))
      .catch(() => setRents(null));
  }, [connection]);

  let total: string | null = null;
  try {
    if (rents) {
      total = lamportsToSol(
        solToLamports(capacitySol) +
          rents.reservation +
          rents.payment * BigInt(Number(maxPayments) || 0)
      );
    }
  } catch {
    total = null;
  }

  async function onReserve() {
    if (!publicKey) return;

    const hoursNumber = Number(hours);
    if (!Number.isFinite(hoursNumber) || hoursNumber <= 0) {
      setHoursError("Enter a finite number of hours greater than zero.");
      setStatus("Please fix the highlighted field.");
      return;
    }

    setHoursError(null);
    setBusy(true);
    setStatus("Preparing…");

    try {
      const capacity = solToLamports(capacitySol);
      const perPaymentCap = solToLamports(capSol);
      const max = Number(maxPayments);

      if (capacity <= 0n || perPaymentCap <= 0n) {
        throw new Error("Amounts must be greater than zero");
      }
      if (perPaymentCap > capacity) {
        throw new Error("Per-payment cap cannot exceed capacity");
      }
      if (!Number.isInteger(max) || max <= 0) {
        throw new Error("Max payments must be a positive whole number");
      }

      const now = await chainNow(connection);
      const expiresAt = BigInt(now + Math.round(hoursNumber * 3600));
      const reservationId = BigInt(Date.now());
      const { ix, reservation } = await buildReserveIx({
        owner: publicKey,
        reservationId,
        capacity,
        perPaymentCap,
        expiresAt,
        maxPayments: max,
      });

      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, ...latest }).add(ix);

      setStatus("Simulating…");
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.error("Simulation failed. Detailed logs:\n", sim.value.logs);
        throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
      }

      setStatus("Approve in your wallet…");
      const sig = await sendTransaction(tx, connection);

      setStatus("Confirming…");
      await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");

      const acct = await fetchReservation(connection, reservation);
      if (!acct) throw new Error("Reservation not found after confirmation");

      const clockOffset = now - Math.floor(Date.now() / 1000);
      await initLedgerIfAbsent(reservation.toBase58(), acct, { maxPayments: max, clockOffset });

      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => undefined);

      setStatus(`Reserved ✔  ${sig.slice(0, 12)}…`);
      onCreated();
    } catch (e: any) {
      if (e.logs) {
        console.error("RPC Error Logs:", e.logs);
      }
      console.error(e);
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function requestAirdrop() {
    if (!publicKey) return;
    setStatus("Requesting 1 SOL devnet airdrop…");
    try {
      const signature = await connection.requestAirdrop(publicKey, 1_000_000_000);
      await connection.confirmTransaction(signature, "confirmed");
      setStatus("Airdrop confirmed. Your devnet wallet is funded.");
    } catch (error) {
      console.error(error);
      setStatus("Devnet faucet is rate-limited right now. Try again later or use faucet.solana.com.");
    }
  }

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setCapacitySol(preset.capacity);
    setCapSol(preset.cap);
    setHours(preset.hours);
    setMaxPayments(preset.max);
    setHoursError(null);
  };

  const isErrorStatus = status?.startsWith("Failed") || status?.startsWith("Please fix");
  const isSuccessStatus = status?.startsWith("Reserved") || status?.startsWith("Airdrop confirmed");

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="presets-title">
        <h2 id="presets-title" className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Pick a size
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PRESETS.map((preset) => {
            const selected =
              preset.capacity === capacitySol && preset.cap === capSol && preset.hours === hours && preset.max === maxPayments;
            return (
              <PricingCard.Card
                key={preset.name}
                className={cn(
                  "max-w-none rounded-[22px] bg-white p-1.5 shadow-none transition-shadow",
                  selected ? "border-ink shadow-[0_0_0_2px_var(--ink)]" : "border-ink/10",
                )}
              >
                <PricingCard.Header className="mb-2 rounded-[18px] border-ink/8 bg-card-cream" glassEffect={false}>
                  <PricingCard.Plan>
                    <PricingCard.PlanName className="text-ink">
                      {preset.icon}
                      <span>{preset.name}</span>
                    </PricingCard.PlanName>
                    {preset.badge && <PricingCard.Badge className="border-0 bg-yellow font-semibold text-ink">{preset.badge}</PricingCard.Badge>}
                  </PricingCard.Plan>
                  <PricingCard.Price>
                    <PricingCard.MainPrice className="font-display text-5xl font-black leading-[0.85] tracking-[-0.05em] [font-stretch:85%]">
                      {preset.capacity}
                    </PricingCard.MainPrice>
                    <PricingCard.Period>SOL / {preset.hours}h</PricingCard.Period>
                  </PricingCard.Price>
                  <PillButton
                    tone={selected ? "dark" : "light"}
                    size="sm"
                    text={selected ? "Selected" : "Use this size"}
                    className="mt-2 w-full"
                    onClick={() => applyPreset(preset)}
                    disabled={busy}
                    aria-pressed={selected}
                  />
                </PricingCard.Header>
                <PricingCard.Body>
                  <PricingCard.Description>{preset.description}</PricingCard.Description>
                  <PricingCard.List>
                    {[`Up to ${preset.cap} SOL per payment`, `Up to ${preset.max} payments`, `Unspent funds return after ${preset.hours}h + 30 min`].map((item) => (
                      <PricingCard.ListItem key={item}>
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden="true" />
                        <span>{item}</span>
                      </PricingCard.ListItem>
                    ))}
                  </PricingCard.List>
                </PricingCard.Body>
              </PricingCard.Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="custom-title" className="rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
        <h2 id="custom-title" className="display-h mb-6 text-[clamp(28px,3.4vw,40px)]">
          Or set your own
        </h2>
        <form
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]"
          onSubmit={(e) => {
            e.preventDefault();
            void onReserve();
          }}
        >
          <div className="grid content-start gap-5 sm:grid-cols-2">
            <Field id="capacitySol" label="Offline capacity (SOL)">
              <input id="capacitySol" className={inputClass} value={capacitySol} onChange={(e) => setCapacitySol(e.target.value)} placeholder="1.0" inputMode="decimal" disabled={busy} />
            </Field>
            <Field id="capSol" label="Per-payment cap (SOL)">
              <input id="capSol" className={inputClass} value={capSol} onChange={(e) => setCapSol(e.target.value)} placeholder="0.5" inputMode="decimal" disabled={busy} />
            </Field>
            <Field id="spendingHours" label="Spending window (hours)" error={hoursError}>
              <input
                id="spendingHours"
                className={inputClass}
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setHoursError(null);
                }}
                inputMode="decimal"
                aria-invalid={Boolean(hoursError)}
                disabled={busy}
              />
            </Field>
            <Field id="maxPayments" label="Max payments" hint="Prepays receipt rent for each payment.">
              <input id="maxPayments" className={inputClass} value={maxPayments} onChange={(e) => setMaxPayments(e.target.value)} inputMode="numeric" disabled={busy} />
            </Field>
            <p className="m-0 text-sm text-muted-foreground sm:col-span-2">
              Each intent expires within 1 hour and never outlives the spending window.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="grainy on-dark rounded-[18px] bg-card-dark p-5 text-white">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-white/60">Wallet pays about</p>
              <p className="m-0 mt-3 font-display text-5xl font-black leading-[0.85] tracking-[-0.05em] [font-stretch:85%]">
                {total ?? "—"} <span className="text-xl tracking-normal">SOL</span>
              </p>
              <p className="m-0 mt-4 text-xs leading-relaxed text-white/65">
                Capacity + rent reserve + account rent, plus ~0.00001 SOL network fee. Unspent funds return on withdraw.
              </p>
            </div>
            <PillButton type="submit" size="lg" text={busy ? "Working…" : "Reserve funds"} disabled={!publicKey || busy} className="w-full" />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-paper px-4 py-3">
              <span className="text-sm">
                Need devnet SOL?{" "}
                <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-4">
                  Faucet
                </a>
              </span>
              <PillButton type="button" size="sm" tone="light" text="Airdrop 1 SOL" onClick={() => void requestAirdrop()} disabled={!publicKey || busy} />
            </div>
            {!publicKey && <StatusNote tone="warning">Connect a wallet first.</StatusNote>}
            {status && <StatusNote tone={isErrorStatus ? "error" : isSuccessStatus ? "success" : "neutral"}>{status}</StatusNote>}
          </div>
        </form>
      </section>
    </div>
  );
}
