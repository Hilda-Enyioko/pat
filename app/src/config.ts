import { PublicKey, clusterApiUrl } from "@solana/web3.js";

const env = (import.meta as any)?.env ?? (globalThis as Record<string, any>).process?.env ?? {};

const configuredProgramId = (env.VITE_PROGRAM_ID as string | undefined);

export const PROGRAM_ID = new PublicKey(configuredProgramId || "11111111111111111111111111111111");
export const CLUSTER = "devnet" as const;
export const RPC_URL = (env.VITE_RPC_URL as string | undefined) ?? clusterApiUrl(CLUSTER);

// Must match programs/pat/src/constants.rs
export const MAX_PAYMENTS_PER_RESERVATION = 1_000;
export const CLUSTER_ID = 1;
export const SETTLE_GRACE_SECS = 30 * 60;

// ---------- USSD rail ----------
const gatewayUrl = (env.VITE_GATEWAY_URL as string | undefined)?.replace(/\/$/, "");
export const GATEWAY_URL = gatewayUrl || null;
/** Dial code shown in the UI. The default is an Africa's Talking sandbox code: simulator only. */
export const USSD_SERVICE_CODE = (env.VITE_USSD_SERVICE_CODE as string | undefined) || "*384*50549#";
export const USSD_SANDBOX = (env.VITE_USSD_SANDBOX as string | undefined) !== "false";
export const USSD_ENABLED = (env.VITE_USSD_ENABLED as string | undefined) === "true" && Boolean(GATEWAY_URL);
/** Local testing only. vite.config.ts fails a production build when this is set. */
export const DEV_ENROLL_TOKEN = (env.VITE_DEV_ENROLL_TOKEN as string | undefined) || null;
/** Lets devnet testers paste any classic SPL mint, not only the gateway's list. */
export const ALLOW_CUSTOM_MINT = CLUSTER === "devnet";
