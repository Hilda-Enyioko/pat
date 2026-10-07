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
