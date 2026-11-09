// Remembers decimals and symbol per mint so token amounts render offline.
import { shortKey } from "./format";

export interface TokenMeta {
  mint: string;
  decimals: number;
  symbol: string;
}

const KEY = "pat:token-meta";
let cache: Record<string, TokenMeta> | null = null;

function load(): Record<string, TokenMeta> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    cache = {};
  }
  return cache!;
}

export function rememberToken(meta: TokenMeta) {
  const all = load();
  const prev = all[meta.mint];
  // A real symbol from the gateway wins over a placeholder from a plain mint lookup.
  const symbol = prev && meta.symbol === placeholderSymbol(meta.mint) ? prev.symbol : meta.symbol;
  all[meta.mint] = { ...meta, symbol };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: kept in memory only */
  }
}

export const placeholderSymbol = (mint: string) => shortKey(mint);

export function tokenMeta(mint: string): TokenMeta | null {
  return load()[mint] ?? null;
}
