// Client for the USSD gateway. Every call goes through guardedFetch, so offline
// mode blocks it the same way it blocks RPC. The service worker never caches these.
import { DEV_ENROLL_TOKEN, GATEWAY_URL } from "../config";
import { guardedFetch, OfflineModeError } from "./network";
import { rememberToken, type TokenMeta } from "./tokens";

export interface GatewayMeta {
  keeper: string;
  programId: string;
  cluster: string;
  mints: TokenMeta[];
}

export interface Challenge {
  challengeId: string;
  /** Exact text the wallet signs. Binds domain, reservation, phone, challenge and expiry. */
  message: string;
  expiresAt: number;
  /** The phone is already enrolled to a different reservation; confirming replaces it. */
  phoneAlreadyEnrolled?: boolean;
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
  otp_invalid: "That code is wrong. Check the SMS and try again.",
  otp_expired: "That code has expired. Request a new one.",
  challenge_expired: "This enrollment request has expired. Start again.",
  challenge_used: "This enrollment request was already used. Start again.",
  too_many_attempts: "Too many wrong codes. Request a new one.",
  bad_signature: "The wallet signature didn't match the reservation owner.",
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

/**
 * The gateway reads the chain at `confirmed`; right after reserving, its RPC can lag
 * ours by a few seconds. Retry "not found" with backoff before giving up.
 */
export async function requestChallenge(phone: string, reservation: string): Promise<Challenge> {
  const delays = [1500, 3000, 6000];
  for (let i = 0; ; i++) {
    try {
      return await call<Challenge>("/enroll/challenge", { method: "POST", body: JSON.stringify({ phone, reservation }) });
    } catch (e) {
      if (!(e instanceof GatewayError) || e.code !== "reservation_not_found" || i >= delays.length) throw e;
      await sleep(delays[i]);
    }
  }
}

export function confirmEnrollment(p: { challengeId: string; otp: string; pin: string; signature: string }) {
  return call<{ ok: true; phoneMasked?: string }>("/enroll/confirm", { method: "POST", body: JSON.stringify(p) });
}

export function enrollStatus(reservation: string) {
  return call<EnrollStatus>(`/enroll/status/${encodeURIComponent(reservation)}`);
}

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
