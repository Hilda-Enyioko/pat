import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";

// In-memory stand-in for localforage (no IndexedDB in node).
const db = new Map<string, unknown>();
vi.mock("localforage", () => ({
  default: {
    createInstance: () => ({
      getItem: async (k: string) => structuredClone(db.get(k) ?? null),
      setItem: async (k: string, v: unknown) => void db.set(k, structuredClone(v)),
      removeItem: async (k: string) => void db.delete(k),
      iterate: async (fn: (v: unknown, k: string) => void) => {
        for (const [k, v] of db) fn(structuredClone(v), k);
      },
    }),
  },
}));

const { availableOffline, debitForPayment, isLocked, isSignable, listLedgers, reconcileWithChain, LedgerError } = await import("../lib/ledger");
type OfflineLedger = import("../lib/ledger").OfflineLedger;

const owner = Keypair.generate().publicKey.toBase58();
const future = Math.floor(Date.now() / 1000) + 3600;

const base = (over: Partial<OfflineLedger> = {}): OfflineLedger => ({
  reservation: Keypair.generate().publicKey.toBase58(),
  owner,
  capacity: "1000",
  perPaymentCap: "500",
  committedOnChain: "100",
  expiresAt: future,
  settleDeadline: future + 1800,
  pending: [],
  history: [],
  nextSequence: 0,
  syncedAt: 0,
  ...over,
});

beforeEach(() => db.clear());

describe("migration", () => {
  it("loads an old record without rail as qr", async () => {
    const old = base();
    delete (old as Partial<OfflineLedger>).rail;
    db.set(old.reservation, old);
    const [l] = await listLedgers(owner);
    expect(l.rail).toBe("qr");
    expect(isSignable(l)).toBe(true);
    expect(availableOffline(l)).toBe(900n);
  });
});

describe("USSD ledgers", () => {
  const ussd = base({ rail: "ussd", mint: Keypair.generate().publicKey.toBase58(), decimals: 6, symbol: "USDC" });

  it("are never signable or locked, and have no offline balance", () => {
    expect(isSignable(ussd)).toBe(false);
    expect(isLocked({ ...ussd, restoredFromChain: true })).toBe(false);
    expect(availableOffline(ussd)).toBe(0n);
  });

  it("refuse debitForPayment", async () => {
    db.set(ussd.reservation, ussd);
    await expect(debitForPayment(ussd.reservation, { paymentId: "ab".repeat(32), amount: 1n }, Math.floor(Date.now() / 1000))).rejects.toMatchObject({
      code: "WRONG_RAIL",
    });
    await expect(debitForPayment(ussd.reservation, { paymentId: "ab".repeat(32), amount: 1n }, 0)).rejects.toBeInstanceOf(LedgerError);
  });
});

describe("legacy detection", () => {
  it("marks a ledger owned by another program as legacy instead of throwing", async () => {
    const l = base();
    db.set(l.reservation, l);
    const connection = {
      getAccountInfo: async () => ({ owner: new PublicKey("HopC7DPpeyiPiq2Nqyy9WDCRBKduNu3PoqyaN6ACZUhh"), data: new Uint8Array(109), lamports: 1, executable: false }),
      getMultipleAccountsInfo: async (keys: unknown[]) => keys.map(() => null),
    };
    const out = await reconcileWithChain(connection as never, l);
    expect(out.legacy).toBe(true);
    expect(isSignable(out)).toBe(false);
    expect(availableOffline(out)).toBe(0n);
  });
});
