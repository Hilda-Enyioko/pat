// App-level offline mode. A web page cannot switch the device into airplane
// mode, so instead every Solana RPC request PAT makes goes through
// guardedFetch, which refuses to touch the network while offline mode is on.

export class OfflineModeError extends Error {
  constructor() {
    super("Offline mode is on. Switch to online to reach the network.");
    this.name = "OfflineModeError";
  }
}

let offlineMode = false;

export function setAppOffline(value: boolean) {
  offlineMode = value;
}

export const guardedFetch: typeof fetch = (input, init) =>
  offlineMode ? Promise.reject(new OfflineModeError()) : fetch(input, init);

const PREF_KEY = "pat:offline-mode";

export function readOfflinePref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOfflinePref(value: boolean) {
  try {
    if (value) localStorage.setItem(PREF_KEY, "1");
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* storage unavailable: the preference just won't survive a reload */
  }
}

/**
 * True if the RPC endpoint answers at all. Bypasses guardedFetch on purpose:
 * it measures the real connection, not the app's offline mode.
 */
export async function probeReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      cache: "no-store",
      signal: controller.signal,
    });
    return true; // any HTTP response, even an error status, means we reached it
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
