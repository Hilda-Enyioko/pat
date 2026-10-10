import { PublicKey, clusterApiUrl } from "@solana/web3.js";

const configuredProgramId = import.meta.env.VITE_PROGRAM_ID as string | undefined;
// Keep the shell renderable when a local preview starts before Vite receives project vars.
export const PROGRAM_ID = new PublicKey(configuredProgramId || "11111111111111111111111111111111");
export const CLUSTER = "devnet" as const;
export const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined) ?? clusterApiUrl(CLUSTER);

// Must match programs/pat/src/constants.rs
export const MAX_PAYMENTS_PER_RESERVATION = 1;
export const CLUSTER_ID = 1;
export const SETTLE_GRACE_SECS = 30 * 60;
