import { useCallback, useEffect, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { CalendarDays, CheckCircle2, Coffee, Tent } from "lucide-react";
import * as PricingCard from "@/components/ui/pricing-card";
import { cn } from "@/lib/utils";
import { ALLOW_CUSTOM_MINT, MAX_PAYMENTS_PER_RESERVATION, SETTLE_GRACE_SECS } from "../config";
import { buildReserveDelegatedIx, chainNow, fetchReservation, mapProgramError, PAYMENT_SPACE, RESERVATION_SPACE } from "../lib/pat";
import { fetchMintInfo, fetchTokenBalance, getAta, TOKEN_ACCOUNT_SPACE } from "../lib/spl";
import { getMeta, type GatewayMeta } from "../lib/gateway";
import { initLedgerIfAbsent } from "../lib/ledger";
import { formatUnits, lamportsToSol, parseUnits, shortKey } from "../lib/format";
import { placeholderSymbol, rememberToken } from "../lib/tokens";
import { InputError, notify, reportError } from "../lib/notify";
import { Field, inputClass } from "./site/Field";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";
import { EnrollPhone } from "./EnrollPhone";

const PRESETS = [
  { name: "Pocket", icon: <Coffee />, capacity: "5", cap: "2", hours: "6", max: "5", description: "Small change for a short trip." },
  { name: "Day pass", icon: <CalendarDays />, badge: "Popular", capacity: "20", cap: "10", hours: "24", max: "20", description: "A day of market runs." },
  { name: "Weekend", icon: <Tent />, capacity: "50", cap: "20", hours: "72", max: "50", description: "Only what you'd carry as cash." },
];

const CUSTOM = "__custom__";

interface Token {
  mint: string;
  symbol: string;
  decimals: number;
  /** null = the wallet has no token account for this mint. */
  balance: bigint | null;
}

const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Token and size", "Reserve on-chain", "Enroll your phone"];
  return (
    <ol className="m-0 grid list-none grid-cols-3 gap-2 p-0" aria-label={`Step ${step} of 3`}>
      {labels.map((label, i) => {
        const n = i + 1;
        return (
          <li
            key={label}
            aria-current={n === step ? "step" : undefined}
            className={cn(
              "rounded-[14px] px-3 py-2 text-xs font-semibold sm:text-sm",
              n < step ? "bg-blue" : n === step ? "bg-ink text-white" : "bg-white text-muted-foreground",
            )}
          >
            <span className="block font-mono text-[11px] opacity-70">Step {n} of 3</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function UssdReserveForm({ online, onCreated }: { online: boolean; onCreated: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [meta, setMeta] = useState<GatewayMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [customMint, setCustomMint] = useState("");
  const [token, setToken] = useState<Token | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState("20");
  const [cap, setCap] = useState("10");
  const [hours, setHours] = useState("24");
  const [maxPayments, setMaxPayments] = useState("20");
  const [rents, setRents] = useState<{ reservation: bigint; payment: bigint; vault: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [created, setCreated] = useState<{ reservation: string; symbol: string } | null>(null);

  useEffect(() => {
    if (!online) return;
    getMeta()
      .then((m) => {
        setMeta(m);
        setMetaError(null);
        setChoice((c) => c || m.mints[0]?.mint || (ALLOW_CUSTOM_MINT ? CUSTOM : ""));
      })
      .catch((e) => {
        setMetaError(e instanceof Error ? e.message : String(e));
        if (ALLOW_CUSTOM_MINT) setChoice((c) => c || CUSTOM);
      });
  }, [online]);

  useEffect(() => {
    if (!online) return;
    Promise.all([
      connection.getMinimumBalanceForRentExemption(RESERVATION_SPACE),
      connection.getMinimumBalanceForRentExemption(PAYMENT_SPACE),
      connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE),
    ])
      .then(([r, p, v]) => setRents({ reservation: BigInt(r), payment: BigInt(p), vault: BigInt(v) }))
      .catch(() => setRents(null));
  }, [connection, online]);

  const mintAddress = choice === CUSTOM ? customMint.trim() : choice;

  const loadToken = useCallback(async () => {
    setToken(null);
    setTokenError(null);
    if (!mintAddress || !publicKey || !online) return;
    let mint: PublicKey;
    try {
      mint = new PublicKey(mintAddress);
    } catch {
      if (choice === CUSTOM && customMint.trim()) setTokenError("That isn't a valid mint address.");
      return;
    }
    try {
      const info = await fetchMintInfo(connection, mint);
      if (!info.ok) {
        setTokenError(
          info.reason === "token2022"
            ? "Token-2022 mints are not supported on this rail. Pick a classic SPL token."
            : info.reason === "missing"
              ? "No mint exists at that address on this cluster."
              : "That address isn't an SPL token mint.",
        );
        return;
      }
      const listed = meta?.mints.find((m) => m.mint === mintAddress);
      const symbol = listed?.symbol ?? placeholderSymbol(mintAddress);
      rememberToken({ mint: mintAddress, decimals: info.decimals, symbol });
      const balance = await fetchTokenBalance(connection, getAta(mint, publicKey));
      setToken({ mint: mintAddress, symbol, decimals: info.decimals, balance });
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : String(e));
    }
  }, [mintAddress, publicKey, online, connection, meta, choice, customMint]);

  useEffect(() => {
    void loadToken();
  }, [loadToken]);

  let solNeeded: string | null = null;
  const max = Number(maxPayments);
  if (rents && Number.isInteger(max) && max > 0) {
    solNeeded = lamportsToSol(rents.reservation + rents.vault + rents.payment * BigInt(max));
  }

  const hoursNumber = Number(hours);
  const previewExpiry = Number.isFinite(hoursNumber) && hoursNumber > 0 ? Math.floor(Date.now() / 1000 + hoursNumber * 3600) : null;

  async function onReserve() {
    if (!publicKey || !token || !meta) return;
    setBusy(true);
    setStatus("Preparing…");
    try {
      let capacityBase: bigint;
      let capBase: bigint;
      try {
        capacityBase = parseUnits(capacity, token.decimals);
        capBase = parseUnits(cap, token.decimals);
      } catch (e) {
        throw new InputError(e instanceof Error ? e.message : "Enter plain numbers, like 20 or 2.5.");
      }
      if (capacityBase <= 0n || capBase <= 0n) throw new InputError("Amounts must be greater than zero.");
      if (capBase > capacityBase) throw new InputError("The per-payment cap can't be more than the amount you reserve.");
      if (!Number.isFinite(hoursNumber) || hoursNumber <= 0) throw new InputError("Enter a spending window in hours, greater than zero.");
      if (!Number.isInteger(max) || max <= 0 || max > MAX_PAYMENTS_PER_RESERVATION) {
        throw new InputError(`Max payments must be a whole number from 1 to ${MAX_PAYMENTS_PER_RESERVATION}.`);
      }
      if (token.balance === null) throw new InputError(`Your wallet has no ${token.symbol} account. Get some ${token.symbol} first.`);
      if (token.balance < capacityBase) {
        throw new InputError(`You have ${formatUnits(token.balance, token.decimals, token.symbol)}, less than the amount you want to reserve.`);
      }
      const delegate = new PublicKey(meta.keeper);
      if (delegate.equals(publicKey) || delegate.equals(PublicKey.default)) {
        throw new InputError("The gateway key cannot be your own wallet or empty.");
      }

      const now = await chainNow(connection);
      const expiresAt = BigInt(now + Math.round(hoursNumber * 3600));
      const reservationId = BigInt(Date.now());
      const { ix, reservation } = await buildReserveDelegatedIx({
        owner: publicKey,
        reservationId,
        capacity: capacityBase,
        perPaymentCap: capBase,
        expiresAt,
        maxPayments: max,
        mint: new PublicKey(token.mint),
        delegate,
      });

      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, ...latest }).add(ix);

      setStatus("Simulating…");
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.error("Simulation failed. Detailed logs:\n", sim.value.logs);
        const simError = new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`) as Error & { logs?: string[] };
        simError.logs = sim.value.logs ?? undefined;
        throw simError;
      }

      setStatus("Approve in your wallet…");
      const sig = await sendTransaction(tx, connection);
      setStatus("Confirming…");
      await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");

      const acct = await fetchReservation(connection, reservation);
      if (!acct) throw new Error("Reservation not found after confirmation");
      const clockOffset = now - Math.floor(Date.now() / 1000);
      await initLedgerIfAbsent(reservation.toBase58(), acct, {
        maxPayments: max,
        clockOffset,
        decimals: token.decimals,
        symbol: token.symbol,
      });
      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => undefined);

      setCreated({ reservation: reservation.toBase58(), symbol: token.symbol });
      notify.success(`Reserved ${capacity} ${token.symbol}`, `Now enroll your phone. Tx ${sig.slice(0, 8)}…`);
    } catch (e) {
      console.error(e);
      reportError(e, {
        title: e instanceof InputError ? "Check your reservation" : "Reservation failed",
        message: e instanceof InputError ? undefined : mapProgramError(e),
      });
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }

  const step: 1 | 2 | 3 = created ? 3 : token ? 2 : 1;

  if (created) {
    return (
      <div className="flex flex-col gap-6">
        <Steps step={3} />
        <section className="rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
          <h2 className="display-h mb-2 text-[clamp(28px,3.4vw,40px)]">Enroll your phone</h2>
          <p className="mt-0 mb-6 max-w-xl text-[15px] leading-relaxed text-ink/80">
            Reservation <span className="font-mono">{shortKey(created.reservation)}</span> is live. Link the phone that
            will pay. If you stop here, the Ledger shows an &ldquo;Enroll phone&rdquo; button so you can finish later.
          </p>
          <EnrollPhone reservation={created.reservation} symbol={created.symbol} online={online} />
          <PillButton tone="light" size="sm" text="Go to ledger" className="mt-6" onClick={onCreated} />
        </section>
      </div>
    );
  }

  const disabled = busy || !online;

  return (
    <div className="flex flex-col gap-8">
      <Steps step={step} />

      {!online && <StatusNote tone="warning">Reserving and enrolling need the network. Switch to online to continue.</StatusNote>}

      <StatusNote tone="warning">
        On this rail your PIN protects the funds, not a key you hold. A compromised gateway could spend up to what you
        reserve, but only to registered merchants. Only reserve what you would carry as cash. There is no early cancel.
      </StatusNote>

      <section aria-labelledby="ussd-presets-title">
        <h2 id="ussd-presets-title" className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Pick a size{token ? ` (${token.symbol})` : ""}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PRESETS.map((preset) => {
            const selected = preset.capacity === capacity && preset.cap === cap && preset.hours === hours && preset.max === maxPayments;
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
                    <PricingCard.Period>{token?.symbol ?? "tokens"} / {preset.hours}h</PricingCard.Period>
                  </PricingCard.Price>
                  <PillButton
                    tone={selected ? "dark" : "light"}
                    size="sm"
                    text={selected ? "Selected" : "Use this size"}
                    className="mt-2 w-full"
                    onClick={() => {
                      setCapacity(preset.capacity);
                      setCap(preset.cap);
                      setHours(preset.hours);
                      setMaxPayments(preset.max);
                    }}
                    disabled={busy}
                    aria-pressed={selected}
                  />
                </PricingCard.Header>
                <PricingCard.Body>
                  <PricingCard.Description>{preset.description}</PricingCard.Description>
                  <PricingCard.List>
                    {[`Up to ${preset.cap} per payment`, `Up to ${preset.max} payments`, `USSD stops after ${preset.hours}h`].map((item) => (
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

      <section aria-labelledby="ussd-custom-title" className="rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)] sm:p-8">
        <h2 id="ussd-custom-title" className="display-h mb-6 text-[clamp(28px,3.4vw,40px)]">
          Token and size
        </h2>
        <form
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]"
          onSubmit={(e) => {
            e.preventDefault();
            void onReserve();
          }}
        >
          <div className="grid content-start gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                id="ussd-token"
                label="Token"
                error={tokenError}
                hint={
                  token
                    ? token.balance === null
                      ? `Your wallet has no ${token.symbol} account yet.`
                      : `Balance: ${formatUnits(token.balance, token.decimals, token.symbol)}`
                    : undefined
                }
              >
                <select
                  id="ussd-token"
                  className={inputClass}
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                  disabled={disabled}
                >
                  {!choice && <option value="">Loading tokens…</option>}
                  {meta?.mints.map((m) => (
                    <option key={m.mint} value={m.mint}>
                      {m.symbol} · {shortKey(m.mint)}
                    </option>
                  ))}
                  {ALLOW_CUSTOM_MINT && <option value={CUSTOM}>Paste a mint address (devnet)</option>}
                </select>
              </Field>
            </div>
            {choice === CUSTOM && (
              <div className="sm:col-span-2">
                <Field id="ussd-mint" label="Mint address" hint="Classic SPL token only. Token-2022 is not supported.">
                  <input
                    id="ussd-mint"
                    className={cn(inputClass, "font-mono text-sm")}
                    value={customMint}
                    onChange={(e) => setCustomMint(e.target.value)}
                    placeholder="Mint public key"
                    spellCheck={false}
                    autoComplete="off"
                    disabled={disabled}
                  />
                </Field>
              </div>
            )}
            <Field id="ussd-capacity" label={`Amount to reserve${token ? ` (${token.symbol})` : ""}`}>
              <input id="ussd-capacity" className={inputClass} value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="decimal" disabled={disabled} />
            </Field>
            <Field id="ussd-cap" label="Per-payment cap">
              <input id="ussd-cap" className={inputClass} value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" disabled={disabled} />
            </Field>
            <Field
              id="ussd-hours"
              label="Window (hours)"
              hint={
                previewExpiry
                  ? `Pay by USSD until ${when(previewExpiry)}. Withdraw opens after ${when(previewExpiry + SETTLE_GRACE_SECS)}.`
                  : undefined
              }
            >
              <input id="ussd-hours" className={inputClass} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" disabled={disabled} />
            </Field>
            <Field id="ussd-max" label="Max payments" hint="Each payment uses one receipt; this prepays their rent.">
              <input id="ussd-max" className={inputClass} value={maxPayments} onChange={(e) => setMaxPayments(e.target.value)} inputMode="numeric" disabled={disabled} />
            </Field>
            {metaError && (
              <StatusNote tone="error" className="sm:col-span-2">
                {metaError}
              </StatusNote>
            )}
            {meta && (
              <p className="m-0 text-sm text-muted-foreground sm:col-span-2">
                Gateway key (spends only to registered merchants): <span className="font-mono">{shortKey(meta.keeper)}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="grainy on-dark rounded-[18px] bg-card-dark p-5 text-white">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-white/60">Tokens locked</p>
              <p className="m-0 mt-3 font-display text-4xl font-black leading-[0.85] tracking-[-0.05em] [font-stretch:85%]">
                {capacity || "—"} <span className="text-lg tracking-normal">{token?.symbol ?? ""}</span>
              </p>
              <p className="m-0 mt-5 text-xs font-semibold uppercase tracking-[0.08em] text-white/60">Plus SOL for rent</p>
              <p className="m-0 mt-2 font-mono text-xl">{solNeeded ?? "—"} SOL</p>
              <p className="m-0 mt-4 text-xs leading-relaxed text-white/65">
                Reservation and vault rent, plus one receipt per payment, plus ~0.00001 SOL fee. Unspent tokens, unused
                receipt rent and account rent come back on withdraw.
              </p>
            </div>
            <PillButton
              type="submit"
              size="lg"
              text={busy ? "Working…" : "Reserve tokens"}
              disabled={!publicKey || !token || !meta || disabled}
              className="w-full"
            />
            {token?.balance === null && (
              <StatusNote tone="warning">
                You hold no {token.symbol}. On devnet, the gateway&rsquo;s seed script (<span className="font-mono">gateway/scripts/seed.ts</span>) creates a
                test mint and funds a wallet; paste that mint above.
              </StatusNote>
            )}
            {!publicKey && <StatusNote tone="warning">Connect a wallet first.</StatusNote>}
            {status && <StatusNote>{status}</StatusNote>}
          </div>
        </form>
      </section>
    </div>
  );
}
