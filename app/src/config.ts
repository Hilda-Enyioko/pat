import { PublicKey, clusterApiUrl } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(import.meta.env.VITE_PROGRAM_ID as string);
export const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined) ?? clusterApiUrl("devnet");

// Must match programs/pat/src/constants.rs
export const MAX_PAYMENTS_PER_RESERVATION = 1;
export const CLUSTER_ID = 1;
export const SETTLE_GRACE_SECS = 30 * 60;