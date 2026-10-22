import { useSyncExternalStore } from "react";
import { OfflineModeError } from "./network";

// App-wide notifications: short toasts that time out, and alert pop-ups for
// failures serious enough to stop and read. A plain module store, so non-React
// code (wallet provider callbacks, effects) can raise them too.

export type Tone = "success" | "error" | "warning" | "info";

export interface Toast {
  id: number;
  key?: string;
  tone: Tone;
  title: string;
  message?: string;
  duration: number;
}

export interface AlertAction {
  label: string;
  onClick?: () => void;
}

export interface Alert {
  id: number;
  tone: "error" | "warning";
  title: string;
  message: string;
  detail?: string;
  actions?: AlertAction[];
}

type State = { toasts: Toast[]; alerts: Alert[] };

const DURATION: Record<Tone, number> = { success: 4000, info: 4500, warning: 6000, error: 7000 };
const MAX_TOASTS = 4;

let state: State = { toasts: [], alerts: [] };
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

type ToastInput = { tone: Tone; title: string; message?: string; key?: string; duration?: number };

function toast({ duration, ...input }: ToastInput): number {
  const id = nextId++;
  const item: Toast = { ...input, id, duration: duration ?? DURATION[input.tone] };
  // A toast with the same key replaces the old one (and restarts its timer).
  const rest = input.key ? state.toasts.filter((t) => t.key !== input.key) : state.toasts;
  set({ ...state, toasts: [...rest, item].slice(-MAX_TOASTS) });
  return id;
}

export const notify = {
  toast,
  success: (title: string, message?: string, opts?: { key?: string }) => toast({ tone: "success", title, message, ...opts }),
  info: (title: string, message?: string, opts?: { key?: string }) => toast({ tone: "info", title, message, ...opts }),
  warning: (title: string, message?: string, opts?: { key?: string }) => toast({ tone: "warning", title, message, ...opts }),
  error: (title: string, message?: string, opts?: { key?: string }) => toast({ tone: "error", title, message, ...opts }),
  alert(input: Omit<Alert, "id" | "tone"> & { tone?: Alert["tone"] }) {
    set({ ...state, alerts: [...state.alerts, { tone: "error", ...input, id: nextId++ }] });
  },
  dismissToast(id: number) {
    set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) });
  },
  dismissAlert(id: number) {
    set({ ...state, alerts: state.alerts.filter((a) => a.id !== id) });
  },
};

export function useNotifications(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** A mistake in what the user typed or scanned: worth a toast, not a pop-up. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function isUserRejection(error: unknown): boolean {
  const text = `${error instanceof Error ? `${error.name} ${error.message}` : String(error)}`.toLowerCase();
  return text.includes("user rejected") || text.includes("rejected the request") || text.includes("user denied") || text.includes("request was rejected") || text.includes("cancelled") || text.includes("canceled");
}

function technicalDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return error == null ? undefined : String(error);
  const logs = (error as Error & { logs?: string[] }).logs;
  const parts = [`${error.name}: ${error.message}`];
  if (logs?.length) parts.push("", "Program logs:", ...logs);
  return parts.join("\n");
}

/**
 * Route a failure to the right surface: cancelled wallet prompts and offline
 * mode get a quiet toast, input mistakes an error toast, anything else an
 * alert pop-up with the readable reason and the technical detail underneath.
 */
export function reportError(
  error: unknown,
  { title, message, actions }: { title: string; message?: string; actions?: AlertAction[] },
) {
  if (isUserRejection(error)) {
    notify.info("Cancelled", "You declined the request in your wallet.");
    return;
  }
  if (error instanceof OfflineModeError) {
    notify.warning("You're in offline mode", "Switch to online to reach the network.", { key: "offline-mode" });
    return;
  }
  const readable = message ?? (error instanceof Error ? error.message : String(error));
  if (error instanceof InputError) {
    notify.error(title, readable);
    return;
  }
  const detail = technicalDetail(error);
  notify.alert({ title, message: readable, detail: detail && detail !== `Error: ${readable}` ? detail : undefined, actions });
}
