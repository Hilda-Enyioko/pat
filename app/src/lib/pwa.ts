// Service worker update + install prompt plumbing, set up before React mounts so
// an early `beforeinstallprompt` or update notice isn't missed.
import { registerSW } from "virtual:pwa-register";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let needRefresh = false;
let installEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setupPwa() {
  updateSW = registerSW({
    onOfflineReady: () => window.dispatchEvent(new Event("pat:offline-ready")),
    // registerType "prompt": a new version waits until the user chooses to reload, so a
    // swap never happens mid-flow while the ledger is being written.
    onNeedRefresh: () => {
      needRefresh = true;
      emit();
    },
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    emit();
  });
}

export const pwaState = () => ({ needRefresh, canInstall: Boolean(installEvent) });

export function subscribePwa(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function applyUpdate() {
  await updateSW?.(true);
}

export function dismissUpdate() {
  needRefresh = false;
  emit();
}

export async function promptInstall() {
  const e = installEvent;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  installEvent = null;
  emit();
  return outcome === "accepted";
}

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export const isIOS = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
