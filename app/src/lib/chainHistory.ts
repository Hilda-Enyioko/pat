import localforage from "localforage";
import { PublicKey, type Connection, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { PROGRAM_ID } from "../config";
import { PAYMENT_SEED, PAYMENT_SPACE, RESERVATION_SPACE } from "./pat";
import { bytesToHex, hexToBytes } from "./intent";

export interface ChainReservation {
  reservation: string;
  owner: string;
  reservationId: string;
  capacity: string;
  committed: string;
  perPaymentCap: string;
  rentReserve: string;
  paymentsSettled: number;
  createdAt: number;
  expiresAt: number;
  settleDeadline: number;
  status: "OPEN" | "WITHDRAWN";
  maxPayments?: number;
  createSig?: string;
  withdrawSig?: string;
  withdrawnAt?: number;
  refunded?: string;
}

export interface ChainPayment {
  paymentId: string;
  reservation: string;
  payer: string;
  merchant: string;
  amount: string;
  sequence: number;
  intentCreatedAt: number;
  settledAt: number;
  settledSlot: number;
  signature?: string;
}

interface EventBase {
  signature: string;
  blockTime: number;
  ix: number;
}

export type ChainEvent =
  | (EventBase & {
      kind: "created";
      reservation: string;
      owner: string;
      reservationId: string;
      capacity: string;
      perPaymentCap: string;
      rentReserve: string;
      maxPayments: number;
      createdAt: number;
      expiresAt: number;
      settleDeadline: number;
    })
  | (EventBase & {
      kind: "settled";
      reservation: string;
      paymentId: string;
      payer: string;
      merchant: string;
      amount: string;
      sequence: number;
      intentCreatedAt: number;
      settledAt: number;
      settledSlot: number;
    })
  | (EventBase & {
      kind: "withdrawn";
      reservation: string;
      owner: string;
      reservationId: string;
      capacity: string;
      committed: string;
      paymentsSettled: number;
      refunded: string;
      withdrawnAt: number;
    });

export type TimelineKind = "RESERVED" | "WITHDRAWN" | "SENT" | "RECEIVED";

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  at: number;
  amount: string;
  counterparty?: string;
  reservation: string;
  signature?: string;
}

export interface WalletHistory {
  wallet: string;
  reservations: ChainReservation[];
  payments: ChainPayment[];
  timeline: TimelineItem[];
  updatedAt: number;
}

export interface HistoryCache {
  wallet: string;
  newestSig?: string;
  events: ChainEvent[];
  openReservations: ChainReservation[];
  payments: ChainPayment[];
  paymentSigs: Record<string, string>;
  updatedAt: number;
}

const OFF = { RES_OWNER: 8, PAY_PAYER: 72, PAY_MERCHANT: 104 } as const;
const FIRST_SCAN_MAX_SIGS = 300;
const TX_CHUNK = 20;
const SIG_LOOKUPS_PER_SYNC = 15;
const SIG_LOOKUP_CHUNK = 5;

const cacheStore = localforage.createInstance({ name: "pat", storeName: "chain_history" });
const inflight = new Map<string, Promise<WalletHistory>>();

class Reader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset: number;

  constructor(bytes: Uint8Array, start = 8) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = start;
  }

  key() {
    const k = new PublicKey(this.bytes.slice(this.offset, this.offset + 32));
    this.offset += 32;
    return k.toBase58();
  }

  hex32() {
    const h = bytesToHex(this.bytes.slice(this.offset, this.offset + 32));
    this.offset += 32;
    return h;
  }

  u64() {
    const x = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return x;
  }

  i64() {
    const x = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return x;
  }

  u32() {
    const x = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return x;
  }

  u8() {
    const x = this.view.getUint8(this.offset);
    this.offset += 1;
    return x;
  }
}

function decodeReservation(pubkey: PublicKey, data: Uint8Array): ChainReservation {
  const r = new Reader(data);
  const owner = r.key();
  const reservationId = r.u64().toString();
  const capacity = r.u64().toString();
  const committed = r.u64().toString();
  const rentReserve = r.u64().toString();
  const perPaymentCap = r.u64().toString();
  const paymentsSettled = r.u32();
  const createdAt = Number(r.i64());
  const expiresAt = Number(r.i64());
  const settleDeadline = Number(r.i64());
  return {
    reservation: pubkey.toBase58(),
    owner,
    reservationId,
    capacity,
    committed,
    rentReserve,
    perPaymentCap,
    paymentsSettled,
    createdAt,
    expiresAt,
    settleDeadline,
    status: "OPEN",
  };
}

function decodePayment(data: Uint8Array): ChainPayment {
  const r = new Reader(data);
  const paymentId = r.hex32();
  const reservation = r.key();
  const payer = r.key();
  const merchant = r.key();
  const amount = r.u64().toString();
  r.u8();
  const intentCreatedAt = Number(r.i64());
  const settledAt = Number(r.i64());
  const settledSlot = Number(r.u64());
  const sequence = r.u32();
  return { paymentId, reservation, payer, merchant, amount, sequence, intentCreatedAt, settledAt, settledSlot };
}

async function fetchOpenReservations(connection: Connection, wallet: string) {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: RESERVATION_SPACE }, { memcmp: { offset: OFF.RES_OWNER, bytes: wallet } }],
  });
  return accounts.map((a) => decodeReservation(a.pubkey, a.account.data));
}

async function fetchPayments(connection: Connection, offset: number, wallet: string) {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: PAYMENT_SPACE }, { memcmp: { offset, bytes: wallet } }],
  });
  return accounts.map((a) => decodePayment(a.account.data));
}

const EVENT_NAMES = ["ReservationCreated", "PaymentSettled", "ReservationWithdrawn"] as const;
type EventName = (typeof EVENT_NAMES)[number];
let discriminators: Map<string, EventName> | null = null;

async function eventDiscriminators() {
  if (discriminators) return discriminators;
  const map = new Map<string, EventName>();
  for (const name of EVENT_NAMES) {
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`event:${name}`))
    );
    map.set(bytesToHex(hash.slice(0, 8)), name);
  }
  discriminators = map;
  return map;
}

function decodeEvent(name: EventName, buf: Uint8Array, base: EventBase): ChainEvent {
  const r = new Reader(buf);

  if (name === "ReservationCreated") {
    const reservation = r.key();
    const owner = r.key();
    const reservationId = r.u64().toString();
    const capacity = r.u64().toString();
    const perPaymentCap = r.u64().toString();
    const rentReserve = r.u64().toString();
    const maxPayments = r.u32();
    const createdAt = Number(r.i64());
    const expiresAt = Number(r.i64());
    const settleDeadline = Number(r.i64());
    return {
      ...base,
      kind: "created",
      reservation,
      owner,
      reservationId,
      capacity,
      perPaymentCap,
      rentReserve,
      maxPayments,
      createdAt,
      expiresAt,
      settleDeadline,
    };
  }

  if (name === "PaymentSettled") {
    const reservation = r.key();
    r.key();
    const paymentId = r.hex32();
    const payer = r.key();
    const merchant = r.key();
    r.key();
    const amount = r.u64().toString();
    const sequence = r.u32();
    const intentCreatedAt = Number(r.i64());
    const settledAt = Number(r.i64());
    const settledSlot = Number(r.u64());
    return {
      ...base,
      kind: "settled",
      reservation,
      paymentId,
      payer,
      merchant,
      amount,
      sequence,
      intentCreatedAt,
      settledAt,
      settledSlot,
    };
  }

  const reservation = r.key();
  const owner = r.key();
  const reservationId = r.u64().toString();
  const capacity = r.u64().toString();
  const committed = r.u64().toString();
  const paymentsSettled = r.u32();
  r.u64();
  r.u64();
  const refunded = r.u64().toString();
  const withdrawnAt = Number(r.i64());
  return {
    ...base,
    kind: "withdrawn",
    reservation,
    owner,
    reservationId,
    capacity,
    committed,
    paymentsSettled,
    refunded,
    withdrawnAt,
  };
}

const INVOKE_RE = /^Program (\w+) invoke \[\d+\]$/;
const EXIT_RE = /^Program (\w+) (?:success|failed)/;
const DATA_PREFIX = "Program data: ";

function eventsFromLogs(
  logs: string[],
  discs: Map<string, EventName>,
  signature: string,
  blockTime: number
) {
  const programId = PROGRAM_ID.toBase58();
  const stack: string[] = [];
  const out: ChainEvent[] = [];

  logs.forEach((line, ix) => {
    const invoke = INVOKE_RE.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      return;
    }
    if (EXIT_RE.test(line)) {
      stack.pop();
      return;
    }
    if (!line.startsWith(DATA_PREFIX) || stack[stack.length - 1] !== programId) return;

    try {
      const buf = Uint8Array.from(atob(line.slice(DATA_PREFIX.length)), (c) => c.charCodeAt(0));
      if (buf.length < 8) return;
      const name = discs.get(bytesToHex(buf.slice(0, 8)));
      if (name) out.push(decodeEvent(name, buf, { signature, blockTime, ix }));
    } catch {
      return;
    }
  });

  return out;
}

async function listSignatures(connection: Connection, wallet: PublicKey, until?: string) {
  const out: ConfirmedSignatureInfo[] = [];
  const cap = until ? Infinity : FIRST_SCAN_MAX_SIGS;
  let before: string | undefined;

  while (out.length < cap) {
    const page = await connection.getSignaturesForAddress(wallet, { before, until, limit: 100 }, "confirmed");
    if (page.length === 0) break;
    out.push(...page);
    before = page[page.length - 1].signature;
    if (page.length < 100) break;
  }

  return out;
}

async function readEvents(
  connection: Connection,
  sigs: ConfirmedSignatureInfo[],
  discs: Map<string, EventName>
) {
  const ok = sigs.filter((s) => !s.err);
  const events: ChainEvent[] = [];

  for (let i = 0; i < ok.length; i += TX_CHUNK) {
    const chunk = ok.slice(i, i + TX_CHUNK);
    const txs = await connection.getParsedTransactions(
      chunk.map((s) => s.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
    );
    txs.forEach((tx, j) => {
      const logs = tx?.meta?.logMessages;
      if (!tx || !logs || tx.meta?.err) return;
      events.push(
        ...eventsFromLogs(logs, discs, chunk[j].signature, tx.blockTime ?? chunk[j].blockTime ?? 0)
      );
    });
  }

  return events;
}

async function resolvePaymentSigs(connection: Connection, cache: HistoryCache) {
  const known = new Set<string>();
  for (const e of cache.events) {
    if (e.kind === "settled") known.add(`${e.reservation}:${e.paymentId}`);
  }

  const missing = cache.payments
    .filter((p) => {
      const k = `${p.reservation}:${p.paymentId}`;
      return !known.has(k) && !cache.paymentSigs[k];
    })
    .slice(0, SIG_LOOKUPS_PER_SYNC);

  for (let i = 0; i < missing.length; i += SIG_LOOKUP_CHUNK) {
    await Promise.all(
      missing.slice(i, i + SIG_LOOKUP_CHUNK).map(async (p) => {
        try {
          const [pda] = PublicKey.findProgramAddressSync(
            [PAYMENT_SEED, new PublicKey(p.reservation).toBytes(), hexToBytes(p.paymentId)],
            PROGRAM_ID
          );
          const sigs = await connection.getSignaturesForAddress(pda, { limit: 5 }, "confirmed");
          const first = [...sigs].reverse().find((s) => !s.err);
          if (first) cache.paymentSigs[`${p.reservation}:${p.paymentId}`] = first.signature;
        } catch {
          return;
        }
      })
    );
  }
}

const eventKey = (e: ChainEvent) => `${e.signature}:${e.ix}`;

export function buildWalletHistory(c: HistoryCache): WalletHistory {
  const wallet = c.wallet;
  const sigs = c.paymentSigs ?? {};
  const events = [...c.events].sort((a, b) => a.blockTime - b.blockTime);
  const res = new Map<string, ChainReservation>();

  for (const e of events) {
    if (e.kind === "created") {
      res.set(e.reservation, {
        reservation: e.reservation,
        owner: e.owner,
        reservationId: e.reservationId,
        capacity: e.capacity,
        committed: "0",
        perPaymentCap: e.perPaymentCap,
        rentReserve: e.rentReserve,
        paymentsSettled: 0,
        createdAt: e.createdAt,
        expiresAt: e.expiresAt,
        settleDeadline: e.settleDeadline,
        status: "OPEN",
        maxPayments: e.maxPayments,
        createSig: e.signature,
      });
    } else if (e.kind === "withdrawn") {
      const prev = res.get(e.reservation);
      res.set(e.reservation, {
        reservation: e.reservation,
        owner: e.owner,
        reservationId: e.reservationId,
        perPaymentCap: "0",
        rentReserve: "0",
        createdAt: 0,
        expiresAt: 0,
        settleDeadline: 0,
        ...prev,
        capacity: e.capacity,
        committed: e.committed,
        paymentsSettled: e.paymentsSettled,
        status: "WITHDRAWN",
        withdrawSig: e.signature,
        withdrawnAt: e.withdrawnAt,
        refunded: e.refunded,
      });
    }
  }

  const openIds = new Set<string>();
  for (const a of c.openReservations) {
    openIds.add(a.reservation);
    const prev = res.get(a.reservation);
    res.set(a.reservation, { ...prev, ...a, maxPayments: prev?.maxPayments, createSig: prev?.createSig });
  }

  const reservations = [...res.values()]
    .map((r) => ({ ...r, status: openIds.has(r.reservation) ? ("OPEN" as const) : ("WITHDRAWN" as const) }))
    .filter((r) => r.owner === wallet)
    .sort((a, b) => b.createdAt - a.createdAt);

  const pay = new Map<string, ChainPayment>();
  const payKey = (reservation: string, paymentId: string) => `${reservation}:${paymentId}`;

  for (const p of c.payments) {
    const k = payKey(p.reservation, p.paymentId);
    pay.set(k, { ...p, signature: sigs[k] });
  }
  for (const e of events) {
    if (e.kind !== "settled") continue;
    const k = payKey(e.reservation, e.paymentId);
    const prev = pay.get(k);
    pay.set(k, {
      paymentId: e.paymentId,
      reservation: e.reservation,
      payer: e.payer,
      merchant: e.merchant,
      amount: e.amount,
      sequence: e.sequence,
      intentCreatedAt: e.intentCreatedAt,
      settledAt: e.settledAt,
      settledSlot: e.settledSlot,
      ...prev,
      signature: e.signature,
    });
  }

  const payments = [...pay.values()]
    .filter((p) => p.payer === wallet || p.merchant === wallet)
    .sort((a, b) => b.settledAt - a.settledAt);

  const timeline: TimelineItem[] = [];

  for (const r of reservations) {
    if (r.createdAt) {
      timeline.push({
        id: `res:${r.reservation}`,
        kind: "RESERVED",
        at: r.createdAt,
        amount: r.capacity,
        reservation: r.reservation,
        signature: r.createSig,
      });
    }
    if (r.status === "WITHDRAWN") {
      const unused = (BigInt(r.capacity) - BigInt(r.committed)).toString();
      timeline.push({
        id: `wd:${r.reservation}`,
        kind: "WITHDRAWN",
        at: r.withdrawnAt ?? r.settleDeadline,
        amount: r.refunded ?? unused,
        reservation: r.reservation,
        signature: r.withdrawSig,
      });
    }
  }

  for (const p of payments) {
    const sent = p.payer === wallet;
    timeline.push({
      id: `pay:${p.reservation}:${p.paymentId}`,
      kind: sent ? "SENT" : "RECEIVED",
      at: p.settledAt,
      amount: p.amount,
      counterparty: sent ? p.merchant : p.payer,
      reservation: p.reservation,
      signature: p.signature,
    });
  }

  timeline.sort((a, b) => b.at - a.at);

  return { wallet, reservations, payments, timeline, updatedAt: c.updatedAt };
}

export async function loadCachedHistory(wallet: string): Promise<WalletHistory | null> {
  const cache = await cacheStore.getItem<HistoryCache>(wallet);
  return cache ? buildWalletHistory(cache) : null;
}

async function runSync(connection: Connection, wallet: string): Promise<WalletHistory> {
  const key = new PublicKey(wallet);
  const prev = await cacheStore.getItem<HistoryCache>(wallet);

  const [open, sent, received, discs, sigs] = await Promise.all([
    fetchOpenReservations(connection, wallet),
    fetchPayments(connection, OFF.PAY_PAYER, wallet),
    fetchPayments(connection, OFF.PAY_MERCHANT, wallet),
    eventDiscriminators(),
    listSignatures(connection, key, prev?.newestSig),
  ]);
  const fresh = await readEvents(connection, sigs, discs);

  const events = new Map<string, ChainEvent>();
  for (const e of [...(prev?.events ?? []), ...fresh]) events.set(eventKey(e), e);

  const payments = new Map<string, ChainPayment>();
  for (const p of [...sent, ...received]) payments.set(`${p.reservation}:${p.paymentId}`, p);

  const cache: HistoryCache = {
    wallet,
    newestSig: sigs[0]?.signature ?? prev?.newestSig,
    events: [...events.values()],
    openReservations: open,
    payments: [...payments.values()],
    paymentSigs: { ...(prev?.paymentSigs ?? {}) },
    updatedAt: Math.floor(Date.now() / 1000),
  };

  await resolvePaymentSigs(connection, cache);
  await cacheStore.setItem(wallet, cache);
  return buildWalletHistory(cache);
}

export function syncWalletHistory(connection: Connection, wallet: string): Promise<WalletHistory> {
  const existing = inflight.get(wallet);
  if (existing) return existing;
  const promise = runSync(connection, wallet).finally(() => inflight.delete(wallet));
  inflight.set(wallet, promise);
  return promise;
}
