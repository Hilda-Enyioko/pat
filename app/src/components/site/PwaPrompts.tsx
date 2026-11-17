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

/**
 * "Install app" entry for the menu. Shows only when the browser can install PAT
 * (or on iOS Safari, where it explains Add to Home Screen) and PAT isn't installed.
 */
export function InstallButton({ onDone }: { onDone?: () => void }) {
  const { canInstall } = usePwa();
  const ios = isIOS();
  if (isStandalone() || (!canInstall && !ios)) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onDone?.();
        if (canInstall) void promptInstall();
        else alert("In Safari, tap Share, then Add to Home Screen.");
      }}
    >
      {ios && !canInstall ? <Share className="mr-1 inline size-4" aria-hidden="true" /> : <Download className="mr-1 inline size-4" aria-hidden="true" />}
      Install app
    </button>
  );
}
