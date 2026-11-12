const LAMPORTS_PER_SOL = 1_000_000_000n;

export function solToLamports(input: string): bigint {
  const m = /^(\d+)(?:\.(\d{0,9}))?$/.exec(input.trim());
  if (!m) throw new Error(`Invalid SOL amount: "${input}"`);
  const frac = (m[2] ?? "").padEnd(9, "0");
  return BigInt(m[1]) * LAMPORTS_PER_SOL + BigInt(frac);
}

export function lamportsToSol(l: bigint): string {
  const whole = l / LAMPORTS_PER_SOL;
  const frac = (l % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const shortKey = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

/** Human token amount -> base units. Throws on bad input or more decimals than the mint has. */
export function parseUnits(input: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(input.trim());
  if (!m) throw new Error(`Invalid amount: "${input}"`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) {
    throw new Error(decimals === 0 ? "This token has no decimal places." : `This token allows at most ${decimals} decimal places.`);
  }
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Base units -> human token amount, trailing zeros trimmed. */
export function formatUnits(value: bigint, decimals: number, symbol?: string): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = decimals ? (v % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  const out = `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
  return symbol ? `${out} ${symbol}` : out;
}
