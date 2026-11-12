export type View = "landing" | "connect" | "ledger" | "reserve" | "sign" | "merchant" | "guide";
export const validViews: View[] = ["landing", "connect", "ledger", "reserve", "sign", "merchant", "guide"];

/** Views anyone can open without a wallet. */
export const PUBLIC_VIEWS: View[] = ["landing", "connect", "guide"];

export const APP_VIEWS: { view: View; label: string }[] = [
  { view: "ledger", label: "Ledger" },
  { view: "reserve", label: "Reserve" },
  { view: "sign", label: "Sign" },
  { view: "merchant", label: "Merchant" },
  { view: "guide", label: "Guide" },
];

export const SOURCE_URL = "https://github.com/Hilda-Enyioko/pat";
export const FAUCET_URL = "https://faucet.solana.com";
