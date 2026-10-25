import localforage from "localforage";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type { ReservationAccount } from "./pat";
import { fetchReservation, PAYMENT_SEED } from "./pat";
import { PROGRAM_ID } from "../config";
import type { WalletHistory, ChainPayment } from "./chainHistory";

const store = localforage.createInstance({ name: "pat", storeName: "ledgers" });

export interface MerchantReceipt {
  signature: string;
  paymentId: string;
  reservation: string;
  payer: string;
  merchant: string;
  amount: string;
  settledAt: number;
  memo?: string;
}

export function saveMerchantReceipt(receipt: MerchantReceipt) {
  const key = `pat:merchant_history:${receipt.merchant}`;
  const raw = localStorage.getItem(key);
  const list: MerchantReceipt[] = raw ? JSON.parse(raw) : [];
  list.unshift(receipt);
  localStorage.setItem(key, JSON.stringify(list));
}

export function getMerchantReceipts(merchantKey: string): MerchantReceipt[] {
  const raw = localStorage.getItem(`pat:merchant_history:${merchantKey}`);
  return raw ? JSON.parse(raw) : [];
}

/** A payment the merchant verified but hasn't settled yet, kept so it can be settled later. */
export interface MerchantPending {
  paymentId: string;
  payload: string;
  amount: string;
  payer: string;
  merchant: string;
  verifiedAt: number;
}

const MERCHANT_PENDING_KEY = "pat:merchant_pending";

export function getMerchantPending(): MerchantPending[] {
  try {
    return JSON.parse(localStorage.getItem(MERCHANT_PENDING_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveMerchantPending(entry: MerchantPending): MerchantPending[] {
  const list = [entry, ...getMerchantPending().filter((p) => p.paymentId !== entry.paymentId)];
  localStorage.setItem(MERCHANT_PENDING_KEY, JSON.stringify(list));
  return list;
}

export function removeMerchantPending(paymentId: string): MerchantPending[] {
  const list = getMerchantPending().filter((p) => p.paymentId !== paymentId);
  localStorage.setItem(MERCHANT_PENDING_KEY, JSON.stringify(list));
  return list;
}

export interface PendingIntent {
  paymentId: string;
  amount: string;
  sequence: number;
  signedAt: number;
}

export type HistoryStatus = "SIGNED" | "SETTLED" | "EXPIRED" | "FAILED";

export interface HistoryEntry {
  paymentId: string;
  merchant: string;
  amount: string;
  createdAt: number;
  expiresAt: number;
  sequence: number;
  memo?: string;
  status: HistoryStatus;
  settleSig?: string;
  settledAt?: number;
  failureReason?: string;
  payload?: string;
}

export interface OfflineLedger {
  reservation: string;
  owner: string;
  capacity: string;
  perPaymentCap: string;
  committedOnChain: string;
  expiresAt: number;
  settleDeadline: number;
  pending: PendingIntent[];
  history: HistoryEntry[];
  nextSequence: number;
  syncedAt: number;
  maxPayments?: number;
  clockOffset?: number;
  restoredFromChain?: boolean;
  withdrawn?: boolean;
}

export type LedgerErrorCode =
  | "NO_LEDGER"
  | "LEDGER_LOCKED"
  | "RESERVATION_EXPIRED"
  | "ZERO_AMOUNT"
  | "OVER_PER_PAYMENT_CAP"
  | "INSUFFICIENT_OFFLINE_BALANCE";

export class LedgerError extends Error {
  code: LedgerErrorCode;
  constructor(code: LedgerErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("pat-ledger", fn) as Promise<T>;
  }
  return fn();
}

export const pendingTotal = (l: OfflineLedger): bigint =>
  l.pending.reduce((sum, p) => sum + BigInt(p.amount), 0n);

export const availableOffline = (l: OfflineLedger): bigint => {
  if (l.withdrawn || l.restoredFromChain) return 0n;
  const v = BigInt(l.capacity) - BigInt(l.committedOnChain) - pendingTotal(l);
  return v > 0n ? v : 0n;
};

export type Phase = "Active" | "Expiring" | "Releasable";

export const phaseOf = (l: OfflineLedger, now: number): Phase =>
  now < l.expiresAt ? "Active" : now <= l.settleDeadline ? "Expiring" : "Releasable";

export const nowAdjusted = (l: OfflineLedger): number =>
  Math.floor(Date.now() / 1000) + (l.clockOffset ?? 0);

export const isLocked = (l: OfflineLedger): boolean => Boolean(l.restoredFromChain) && !l.withdrawn;

export const isSignable = (l: OfflineLedger): boolean =>
  !l.withdrawn && !l.restoredFromChain && nowAdjusted(l) < l.expiresAt;

export const isReleasable = (l: OfflineLedger, now = nowAdjusted(l)): boolean =>
  !l.withdrawn && now > l.settleDeadline;

export const releasesIn = (l: OfflineLedger, now = nowAdjusted(l)): number =>
  Math.max(0, l.settleDeadline + 1 - now);

export const randomPaymentIdHex = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

export const getLedger = (reservation: string) => store.getItem<OfflineLedger>(reservation);

function migrate(l: OfflineLedger): OfflineLedger {
  const history: HistoryEntry[] =
    l.history ??
    (l.pending ?? []).map((p) => ({
      paymentId: p.paymentId,
      merchant: "",
      amount: p.amount,
      createdAt: p.signedAt,
      expiresAt: l.expiresAt,
      sequence: p.sequence,
      status: "SIGNED" as const,
    }));
  return {
    ...l,
    pending: l.pending ?? [],
    history,
    nextSequence: l.nextSequence ?? Math.max(0, ...history.map((h) => h.sequence + 1)),
  };
}

export async function listLedgers(owner: string): Promise<OfflineLedger[]> {
  const out: OfflineLedger[] = [];
  await store.iterate<OfflineLedger, void>((v) => {
    if (v.owner === owner) out.push(migrate(v));
  });
  return out.sort((a, b) => b.expiresAt - a.expiresAt);
}

export const deleteLedger = (reservation: string) => store.removeItem(reservation);

export function initLedgerIfAbsent(
  reservation: string,
  acct: ReservationAccount,
  metadata?: Pick<OfflineLedger, "maxPayments" | "clockOffset">
): Promise<OfflineLedger> {
  return withLock(async () => {
    const existing = await store.getItem<OfflineLedger>(reservation);
    if (existing) {
      const m = migrate(existing);
      if (m.restoredFromChain) {
        m.restoredFromChain = false;
        await store.setItem(reservation, m);
      }
      return m;
    }
    const ledger: OfflineLedger = {
      reservation,
      owner: acct.owner.toBase58(),
      capacity: acct.capacity.toString(),
      perPaymentCap: acct.perPaymentCap.toString(),
      committedOnChain: acct.committed.toString(),
      expiresAt: Number(acct.expiresAt),
      settleDeadline: Number(acct.settleDeadline),
      pending: [],
      history: [],
      nextSequence: 0,
      syncedAt: Math.floor(Date.now() / 1000),
      ...metadata,
    };
    await store.setItem(reservation, ledger);
    return ledger;
  });
}

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

export function debitForPayment(
  reservation: string,
  req: { paymentId: string; amount: bigint },
  now: number
): Promise<{ sequence: number; committedAfter: bigint }> {
  return withLock(async () => {
    const raw = await store.getItem<OfflineLedger>(reservation);
    if (!raw) throw new LedgerError("NO_LEDGER");
    const l = migrate(raw);
    if (l.restoredFromChain) {
      throw new LedgerError(
        "LEDGER_LOCKED",
        "Reservation was restored from chain. Signing is disabled on this device."
      );
    }
    if (l.withdrawn || now >= l.expiresAt) throw new LedgerError("RESERVATION_EXPIRED");
    if (req.amount <= 0n) throw new LedgerError("ZERO_AMOUNT");
    if (req.amount > BigInt(l.perPaymentCap)) throw new LedgerError("OVER_PER_PAYMENT_CAP");
    if (req.amount > availableOffline(l)) throw new LedgerError("INSUFFICIENT_OFFLINE_BALANCE");
    const sequence = l.nextSequence++;
    const committedAfter = BigInt(l.committedOnChain) + pendingTotal(l) + req.amount;
    l.pending.push({
      paymentId: req.paymentId,
      amount: req.amount.toString(),
      sequence,
      signedAt: now,
    });
    await store.setItem(reservation, l);
    return { sequence, committedAfter };
  });
}

export function addHistoryEntry(reservation: string, entry: HistoryEntry) {
  return withLock(async () => {
    const raw = await store.getItem<OfflineLedger>(reservation);
    if (!raw) throw new LedgerError("NO_LEDGER");
    const l = migrate(raw);
    const existing = l.history.find((h) => h.paymentId === entry.paymentId);
    if (existing) {
      const merged: HistoryEntry = {
        ...existing,
        ...entry,
        memo: entry.memo ?? existing.memo,
        payload: entry.payload ?? existing.payload,
      };
      l.history = l.history.map((h) => (h.paymentId === entry.paymentId ? merged : h));
    } else {
      l.history = [...l.history, entry];
    }
    if (entry.status !== "SIGNED") {
      l.pending = l.pending.filter((p) => p.paymentId !== entry.paymentId);
    }
    await store.setItem(reservation, l);
    return l;
  });
}

export function rollbackPending(paymentId: string) {
  return withLock(async () => {
    const keys: string[] = [];
    await store.iterate<OfflineLedger, void>((l, key) => {
      if (l.pending?.some((p) => p.paymentId === paymentId)) keys.push(String(key));
    });
    for (const key of keys) {
      const l = await store.getItem<OfflineLedger>(key);
      if (!l) continue;
      l.pending = l.pending.filter((p) => p.paymentId !== paymentId);
      l.history = (l.history ?? []).filter((h) => h.paymentId !== paymentId);
      await store.setItem(key, l);
    }
  });
}

function patchEntry(reservation: string, paymentId: string, patch: Partial<HistoryEntry>) {
  return withLock(async () => {
    const l = await store.getItem<OfflineLedger>(reservation);
    if (!l) return;
    const m = migrate(l);
    m.pending = m.pending.filter((p) => p.paymentId !== paymentId);
    m.history = m.history.map((h) => (h.paymentId === paymentId ? { ...h, ...patch } : h));
    await store.setItem(reservation, m);
  });
}

export const markSettled = (reservation: string, paymentId: string, settleSig?: string, settledAt?: number) =>
  patchEntry(reservation, paymentId, {
    status: "SETTLED",
    ...(settleSig ? { settleSig } : {}),
    ...(settledAt ? { settledAt } : {}),
  });

export const markExpired = (reservation: string, paymentId: string) =>
  patchEntry(reservation, paymentId, { status: "EXPIRED" });

export const markFailed = (reservation: string, paymentId: string, reason: string) =>
  patchEntry(reservation, paymentId, { status: "FAILED", failureReason: reason });

function resolveSigned(l: OfflineLedger, settled: Set<string>, open: boolean) {
  const now = nowAdjusted(l);
  l.history = l.history.map((h) => {
    if (h.status !== "SIGNED") return h;
    if (settled.has(h.paymentId)) return { ...h, status: "SETTLED" as const };
    if (!open) return { ...h, status: "FAILED" as const, failureReason: "Reservation withdrawn" };
    if (now > l.settleDeadline) return { ...h, status: "EXPIRED" as const };
    return h;
  });
  const done = new Set(l.history.filter((h) => h.status !== "SIGNED").map((h) => h.paymentId));
  l.pending = l.pending.filter((p) => !done.has(p.paymentId));
}

async function findSettled(connection: Connection, reservation: PublicKey, ids: string[]) {
  const settled = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const keys = chunk.map(
      (id) =>
        PublicKey.findProgramAddressSync(
          [PAYMENT_SEED, reservation.toBytes(), Uint8Array.from(id.match(/.{2}/g)!, (x) => parseInt(x, 16))],
          PROGRAM_ID
        )[0]
    );
    const infos = await connection.getMultipleAccountsInfo(keys);
    infos.forEach((info, j) => {
      if (info) settled.add(chunk[j]);
    });
  }
  return settled;
}

export async function reconcileWithChain(connection: Connection, ledger: OfflineLedger) {
  const resKey = new PublicKey(ledger.reservation);
  const stored = await getLedger(ledger.reservation);
  if (!stored) throw new LedgerError("NO_LEDGER");

  const signedIds = migrate(stored)
    .history.filter((h) => h.status === "SIGNED")
    .map((h) => h.paymentId);

  const [reservation, settled] = await Promise.all([
    fetchReservation(connection, resKey),
    findSettled(connection, resKey, signedIds),
  ]);

  return withLock(async () => {
    const latest = await store.getItem<OfflineLedger>(ledger.reservation);
    if (!latest) throw new LedgerError("NO_LEDGER");
    const m = migrate(latest);
    if (reservation) m.committedOnChain = reservation.committed.toString();
    m.withdrawn = !reservation;
    m.syncedAt = Math.floor(Date.now() / 1000);
    resolveSigned(m, settled, Boolean(reservation));
    await store.setItem(ledger.reservation, m);
    return m;
  });
}

export function mergeChainIntoLedgers(
  wallet: string,
  h: WalletHistory,
  opts: { clockOffset?: number } = {}
): Promise<void> {
  return withLock(async () => {
    const local = new Map<string, OfflineLedger>();
    await store.iterate<OfflineLedger, void>((v) => {
      if (v.owner === wallet) local.set(v.reservation, migrate(v));
    });

    const sentByReservation = new Map<string, Map<string, ChainPayment>>();
    for (const p of h.payments) {
      if (p.payer !== wallet) continue;
      if (!sentByReservation.has(p.reservation)) sentByReservation.set(p.reservation, new Map());
      sentByReservation.get(p.reservation)!.set(p.paymentId, p);
    }

    const now = Math.floor(Date.now() / 1000);

    for (const r of h.reservations) {
      const settled = sentByReservation.get(r.reservation) ?? new Map<string, ChainPayment>();
      const open = r.status === "OPEN";
      let l = local.get(r.reservation);

      if (!l) {
        if (!open) continue;
        l = {
          reservation: r.reservation,
          owner: wallet,
          capacity: r.capacity,
          perPaymentCap: r.perPaymentCap,
          committedOnChain: r.committed,
          expiresAt: r.expiresAt,
          settleDeadline: r.settleDeadline,
          pending: [],
          history: [],
          nextSequence: 0,
          syncedAt: now,
          maxPayments: r.maxPayments,
          clockOffset: opts.clockOffset ?? 0,
          restoredFromChain: true,
        };
      }

      const known = new Set(l.history.map((x) => x.paymentId));

      l.history = l.history.map((x) => {
        const p = settled.get(x.paymentId);
        if (!p || x.status === "SETTLED") return x;
        return {
          ...x,
          status: "SETTLED" as const,
          settleSig: p.signature ?? x.settleSig,
          settledAt: p.settledAt,
          failureReason: undefined,
        };
      });

      for (const p of settled.values()) {
        if (known.has(p.paymentId)) continue;
        l.history.push({
          paymentId: p.paymentId,
          merchant: p.merchant,
          amount: p.amount,
          createdAt: p.intentCreatedAt,
          expiresAt: p.settledAt,
          sequence: p.sequence,
          status: "SETTLED",
          settleSig: p.signature,
          settledAt: p.settledAt,
        });
      }

      l.pending = l.pending.filter((x) => !settled.has(x.paymentId));
      if (open) l.committedOnChain = r.committed;
      l.withdrawn = !open;
      resolveSigned(l, new Set(settled.keys()), open);
      l.nextSequence = Math.max(l.nextSequence, ...[...settled.values()].map((p) => p.sequence + 1));
      l.syncedAt = now;

      await store.setItem(r.reservation, l);
    }
  });
}

export { store as ledgerStore };
export type { ReservationAccount };
