import { PublicKey, clusterApiUrl } from "@solana/web3.js";

const env = (import.meta as any)?.env ?? (globalThis as Record<string, any>).process?.env ?? {};

const configuredProgramId = (env.VITE_PROGRAM_ID as string | undefined);

export const PROGRAM_ID = new PublicKey(configuredProgramId || "11111111111111111111111111111111");
export const CLUSTER = "devnet" as const;
export const RPC_URL = (env.VITE_RPC_URL as string | undefined) ?? clusterApiUrl(CLUSTER);

// Must match programs/pat/src/constants.rs
export const MAX_PAYMENTS_PER_RESERVATION = 1;
export const CLUSTER_ID = 1;
export const SETTLE_GRACE_SECS = 30 * 60;
