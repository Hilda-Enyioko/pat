import localforage from "localforage";
import type { ReservationAccount } from "./pat";

const store = localforage.createInstance({ name: "pat", storeName: "ledgers" });

// Lamport amounts are persisted as decimal strings: BigInt is not JSON-safe, and
// localForage can fall back to localStorage, which would throw on a BigInt.
export interface PendingIntent {
  paymentId: string; // hex
  amount: string;
  sequence: number;
  signedAt: number;  // unix seconds
}

export interface OfflineLedger {
  reservation: string; // base58 address, also the storage key
  owner: string;
  capacity: string;
  perPaymentCap: string;
  committedOnChain: string;
  expiresAt: number;
  settleDeadline: number;
  pending: PendingIntent[];
  nextSequence: number;
  syncedAt: number;
}

export type LedgerErrorCode =
  | "NO_LEDGER" | "RESERVATION_EXPIRED" | "ZERO_AMOUNT"
  | "OVER_PER_PAYMENT_CAP" | "INSUFFICIENT_OFFLINE_BALANCE";

export class LedgerError extends Error {
  code: LedgerErrorCode;
  constructor(code: LedgerErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

// One lock across tabs so two rapid debits can never read the same balance.
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("pat-ledger", fn) as Promise<T>;
  }
  return fn(); // old browsers: no cross-tab guarantee
}

// ---------- pure math ----------
export const pendingTotal = (l: OfflineLedger): bigint =>
  l.pending.reduce((s, p) => s + BigInt(p.amount), 0n);

/** capacity - committed_on_chain - sum(pending). Clamped at 0 for display only. */
export const availableOffline = (l: OfflineLedger): bigint => {
  const v = BigInt(l.capacity) - BigInt(l.committedOnChain) - pendingTotal(l);
  return v > 0n ? v : 0n;
};

export type Phase = "Active" | "Expiring" | "Releasable";
export const phaseOf = (l: OfflineLedger, now: number): Phase =>
  now < l.expiresAt ? "Active" : now <= l.settleDeadline ? "Expiring" : "Releasable";

export const randomPaymentIdHex = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

// ---------- persistence ----------
export const getLedger = (reservation: string) => store.getItem<OfflineLedger>(reservation);

export async function listLedgers(owner: string): Promise<OfflineLedger[]> {
  const out: OfflineLedger[] = [];
  await store.iterate<OfflineLedger, void>((v) => { if (v.owner === owner) out.push(v); });
  return out.sort((a, b) => b.expiresAt - a.expiresAt);
}

export const deleteLedger = (reservation: string) => store.removeItem(reservation);

/** Never overwrites: an existing ledger may hold pending intents that would be lost. */
export function initLedgerIfAbsent(reservation: string, acct: ReservationAccount): Promise<OfflineLedger> {
  return withLock(async () => {
    const existing = await store.getItem<OfflineLedger>(reservation);
    if (existing) return existing;
    const ledger: OfflineLedger = {
      reservation,
      owner: acct.owner.toBase58(),
      capacity: acct.capacity.toString(),
      perPaymentCap: acct.perPaymentCap.toString(),
      committedOnChain: acct.committed.toString(),
      expiresAt: Number(acct.expiresAt),
      settleDeadline: Number(acct.settleDeadline),
      pending: [],
      nextSequence: 0,
      syncedAt: Math.floor(Date.now() / 1000),
    };
    await store.setItem(reservation, ledger);
    return ledger;
  });
}

/**
 * Day 5 refresh: updates committed_on_chain only. Pending intents are kept, so a pending
 * intent that already settled is counted twice until the Day 8 reconcile. That errs toward
 * a LOWER balance (fail closed), which is the safe direction.
 */
export function refreshCommitted(reservation: string, acct: ReservationAccount): Promise<OfflineLedger> {
  return withLock(async () => {
    const l = await store.getItem<OfflineLedger>(reservation);
    if (!l) throw new LedgerError("NO_LEDGER");
    l.committedOnChain = acct.committed.toString();
    l.syncedAt = Math.floor(Date.now() / 1000);
    await store.setItem(reservation, l);
    return l;
  });
}

/**
 * The signing gate. Persists the debit BEFORE the caller produces a signature (write-ahead).
 * Day 6 calls this, then signs the intent with the returned sequence/committedAfter.
 */
export function debitForPayment(
  reservation: string,
  req: { paymentId: string; amount: bigint },
  now: number,
): Promise<{ sequence: number; committedAfter: bigint }> {
  return withLock(async () => {
    const l = await store.getItem<OfflineLedger>(reservation);
    if (!l) throw new LedgerError("NO_LEDGER");
    if (now >= l.expiresAt) throw new LedgerError("RESERVATION_EXPIRED");
    if (req.amount <= 0n) throw new LedgerError("ZERO_AMOUNT");
    if (req.amount > BigInt(l.perPaymentCap)) throw new LedgerError("OVER_PER_PAYMENT_CAP");
    if (req.amount > availableOffline(l)) throw new LedgerError("INSUFFICIENT_OFFLINE_BALANCE");

    const sequence = l.nextSequence;
    const committedAfter = BigInt(l.committedOnChain) + pendingTotal(l) + req.amount;
    l.pending.push({ paymentId: req.paymentId, amount: req.amount.toString(), sequence, signedAt: now });
    l.nextSequence += 1;
    await store.setItem(reservation, l); // persisted before returning
    return { sequence, committedAfter };
  });
}
