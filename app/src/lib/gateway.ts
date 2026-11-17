// Client for the USSD gateway. Every call goes through guardedFetch, so offline
// mode blocks it the same way it blocks RPC. The service worker never caches these.
import { DEV_ENROLL_TOKEN, GATEWAY_URL } from "../config";
import { guardedFetch, OfflineModeError } from "./network";
import { rememberToken, type TokenMeta } from "./tokens";

export interface GatewayMeta {
  keeper: string;
  programId: string;
  cluster: string;
  serviceCode?: string;
  sandbox?: boolean;
  merchantActivation?: boolean;
  mints: TokenMeta[];
}

/** A phone-link request: the user dials the service code from the phone and types linkCode. */
export interface PhoneLink {
  linkId: string;
  linkCode: string;
  expiresAt: number;
  serviceCode: string;
  /** The phone already pays from another reservation; finishing moves it here. */
  phoneAlreadyEnrolled: boolean;
}

export interface LinkStatus {
  verified: boolean;
  used: boolean;
  expired: boolean;
}

export interface MerchantCode {
  wallet: string;
  code: number;
  status: "reserved" | "active";
  canActivate: boolean;
}

export interface MerchantPayment {
  id: string;
  code: number;
  amount: string;
  display: string;
  mint: string;
  decimals: number;
  symbol: string;
  status: "pending" | "sending" | "settled" | "failed";
  signature: string | null;
  payer: string;
  createdAt: number;
  updatedAt: number;
}

export interface EnrollStatus {
  enrolled: boolean;
  phoneMasked?: string;
}

export class GatewayError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
  }
}

const FRIENDLY: Record<string, string> = {
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  link_expired: "This link request has expired. Start again.",
  link_used: "This link request was already used. Start again.",
  link_not_found: "This link request has expired. Start again.",
  phone_not_verified: "The phone hasn't dialled in yet. Dial the code on that phone and enter the link code.",
  tx_not_found: "The gateway can't see your reservation transaction yet. Try again in a few seconds.",
  tx_failed: "The reservation transaction failed on-chain.",
  bad_signature: "The wallet signature didn't match the reservation owner.",
  bad_owner: "Connect a wallet first.",
  bad_wallet: "That isn't a valid wallet address.",
  activation_unavailable: "Merchant activation isn't switched on for this gateway yet.",
  activation_in_progress: "Activation is already running. Wait a few seconds.",
  no_code: "This wallet has no merchant code yet. Reload the page.",
  reservation_not_found: "The gateway can't see your reservation yet.",
  reservation_expired: "This reservation's spending window has ended. Reserve again to use USSD.",
  not_delegated: "This reservation isn't set up for this gateway.",
  reservation_taken: "This reservation is already enrolled to another phone number.",
  bad_phone: "Enter the phone number in international format, like +2348012345678.",
  bad_pin: "The PIN must be exactly 4 digits.",
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!GATEWAY_URL) throw new GatewayError(0, "not_configured", "The USSD gateway is not configured for this app.");
  let res: Response;
  try {
    res = await guardedFetch(`${GATEWAY_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e) {
    if (e instanceof OfflineModeError) throw e;
    throw new GatewayError(0, "unreachable", "Couldn't reach the USSD gateway. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
    const message = FRIENDLY[code] ?? (typeof body.message === "string" ? body.message : `Gateway error (${res.status}).`);
    throw new GatewayError(res.status, res.status === 429 ? "rate_limited" : code, res.status === 429 ? FRIENDLY.rate_limited : message);
  }
  return body as T;
}

const META_KEY = "pat:gateway-meta";

export async function getMeta(): Promise<GatewayMeta> {
  const meta = await call<GatewayMeta>("/meta");
  meta.mints.forEach(rememberToken);
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* fine: refetched next time */
  }
  return meta;
}

/** Last /meta seen, for showing the keeper key while offline. */
export function cachedMeta(): GatewayMeta | null {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "null");
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/** Memo the reserve transaction carries so it doubles as the wallet's proof. Must match gateway/src/enroll.ts. */
export const enrollMemo = (linkId: string) => `PAT-ENROLL-v2 ${linkId}`;

/** Text signed to link a phone to a reservation that already exists. Must match gateway/src/enroll.ts. */
export const enrollMessage = (linkId: string, phone: string, reservation: string) =>
  [
    "PAT-ENROLL-v2",
    `link: ${linkId}`,
    `phone: ${phone}`,
    `reservation: ${reservation}`,
    "",
    "Sign to let this phone pay from this reservation over USSD. This is not a transaction.",
  ].join("\n");

/** Text signed to activate a merchant code. Must match gateway/src/merchant.ts. */
export const activationMessage = (code: number, wallet: string) =>
  [
    "PAT-MERCHANT-v1",
    `code: ${code}`,
    `payout: ${wallet}`,
    "",
    "Sign to receive USSD payments to this wallet under this code. This is not a transaction.",
  ].join("\n");

export const startPhoneLink = (phone: string, owner: string) => call<PhoneLink>("/enroll/start", post({ phone, owner }));

export const linkStatus = (linkId: string) => call<LinkStatus>(`/enroll/link/${encodeURIComponent(linkId)}`);

/**
 * Binds the verified phone + PIN to a reservation. Proof of wallet is either the reserve
 * transaction (txSignature, which carries enrollMemo) or a signMessage over enrollMessage.
 * Right after reserving, the gateway's RPC can lag ours, so "not found yet" is retried.
 */
export async function finishPhoneLink(p: {
  linkId: string;
  reservation: string;
  pin: string;
  txSignature?: string;
  signature?: string;
}) {
  const delays = [1500, 3000, 6000];
  for (let i = 0; ; i++) {
    try {
      return await call<{ ok: true; phoneMasked: string }>("/enroll/finish", post(p));
    } catch (e) {
      const retry = e instanceof GatewayError && (e.code === "reservation_not_found" || e.code === "tx_not_found");
      if (!retry || i >= delays.length) throw e;
      await sleep(delays[i]);
    }
  }
}

export function enrollStatus(reservation: string) {
  return call<EnrollStatus>(`/enroll/status/${encodeURIComponent(reservation)}`);
}

export const merchantMe = (wallet: string) => call<MerchantCode>(`/merchant/me/${encodeURIComponent(wallet)}`);

export const activateMerchant = (wallet: string, signature: string) =>
  call<MerchantCode & { tx?: string | null }>("/merchant/activate", post({ wallet, signature }));

export const merchantPayments = (wallet: string) =>
  call<{ payments: MerchantPayment[] }>(`/merchant/payments/${encodeURIComponent(wallet)}`);

/** 3017224044 -> "301 722 4044": easier to read out and type. */
export const formatMerchantCode = (code: number) => {
  const s = String(code);
  return s.length === 10 ? `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}` : s;
};

/** tel: link for a USSD code; # must be escaped or the dialler drops it. */
export const dialHref = (code: string) => `tel:${code.replace(/#/g, "%23")}`;

/** Local testing only: the shared-token /enroll endpoint. Never available in production builds. */
export function devEnroll(p: { phone: string; reservation: string; pin: string; symbol: string }) {
  if (!DEV_ENROLL_TOKEN) throw new GatewayError(0, "not_configured", "Dev enrollment is off.");
  return call<{ ok: true }>("/enroll", {
    method: "POST",
    headers: { "x-enroll-token": DEV_ENROLL_TOKEN },
    body: JSON.stringify(p),
  });
}

export const PHONE_RE = /^\+\d{8,15}$/;
/** Mirrors validPinFormat in gateway/src/pin.ts. */
export const validPinFormat = (pin: string) => /^\d{4}$/.test(pin);
