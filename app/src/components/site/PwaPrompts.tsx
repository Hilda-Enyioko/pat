import { useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, Share, X } from "lucide-react";
import { applyUpdate, dismissUpdate, isIOS, isStandalone, promptInstall, pwaState, subscribePwa } from "@/lib/pwa";
import { PillButton } from "./Pill";

let snapshot = pwaState();
const getSnapshot = () => {
  const next = pwaState();
  if (next.needRefresh !== snapshot.needRefresh || next.canInstall !== snapshot.canInstall) snapshot = next;
  return snapshot;
};
const usePwa = () => useSyncExternalStore(subscribePwa, getSnapshot, getSnapshot);

const DISMISS_KEY = "pat:install-dismissed";
const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

/** "Update available" bar. Reloading applies the new service worker. */
export function UpdatePrompt() {
  const { needRefresh } = usePwa();
  const [busy, setBusy] = useState(false);
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg flex-wrap items-center gap-3 rounded-[18px] bg-ink p-4 text-white shadow-xl">
      <RefreshCw className="size-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-sm">A new version of PAT is ready. Finish what you&rsquo;re doing, then reload.</span>
      <PillButton size="sm" tone="red" text={busy ? "Reloading…" : "Reload"} disabled={busy} onClick={() => { setBusy(true); void applyUpdate(); }} />
      <button type="button" aria-label="Later" onClick={dismissUpdate} className="grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-white/10 text-white">
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Install card: native prompt on Android/Chrome, Add to Home Screen steps on iOS Safari. */
export function InstallPrompt() {
  const { canInstall } = usePwa();
  const [dismissed, setDismissed] = useState(readDismissed);
  const ios = isIOS();
  if (dismissed || isStandalone() || (!canInstall && !ios)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* shown again next visit */
    }
  };

  return (
    <section aria-label="Install PAT" className="mb-6 flex flex-wrap items-start gap-4 rounded-[22px] bg-white p-5 shadow-[0_16px_36px_-24px_rgba(15,15,14,.35)]">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-yellow">
        {ios ? <Share className="size-5" aria-hidden="true" /> : <Download className="size-5" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="m-0 font-semibold">Install PAT on this device</p>
        <p className="m-0 text-sm leading-relaxed text-ink/75">
          It opens like an app, works offline, and your browser is less likely to clear its storage. That matters:
          your offline ledger lives on this device.
        </p>
        {ios && !canInstall && (
          <p className="m-0 text-sm leading-relaxed">
            In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {canInstall && <PillButton size="sm" text="Install PAT" onClick={() => void promptInstall()} />}
        <button type="button" aria-label="Dismiss" onClick={dismiss} className="grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-paper text-ink">
          <X className="size-4" />
        </button>
      </div>
    </section>
  );
}
