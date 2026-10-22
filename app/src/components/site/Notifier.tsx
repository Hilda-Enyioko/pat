import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { notify, useNotifications, type Alert, type Toast, type Tone } from "@/lib/notify";
import { PillButton } from "./Pill";

const ICON: Record<Tone, typeof Info> = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
const CHIP: Record<Tone, string> = { success: "bg-blue", error: "bg-red text-white", warning: "bg-yellow", info: "bg-stone" };
const BAR: Record<Tone, string> = { success: "bg-blue", error: "bg-red", warning: "bg-yellow", info: "bg-ink/30" };

function ToastCard({ toast }: { toast: Toast }) {
  const Icon = ICON[toast.tone];
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className="toast group relative flex items-start gap-3 overflow-hidden rounded-[18px] bg-white p-3.5 pr-11 text-ink shadow-[0_0_0_1px_rgba(15,15,14,.08),0_20px_40px_-20px_rgba(15,15,14,.45)]"
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", CHIP[toast.tone])} aria-hidden="true">
        <Icon className="size-4" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 pt-1">
        <span className="block text-sm font-semibold leading-snug">{toast.title}</span>
        {toast.message && <span className="mt-0.5 block text-sm leading-snug break-words text-ink/70">{toast.message}</span>}
      </span>
      <button
        type="button"
        onClick={() => notify.dismissToast(toast.id)}
        aria-label="Dismiss"
        className="absolute top-2.5 right-2.5 grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink/50 transition-colors hover:bg-paper hover:text-ink"
      >
        <X className="size-4" />
      </button>
      {/* The draining bar is the timer: when its animation ends, the toast goes. Hover or focus pauses it. */}
      <span
        aria-hidden="true"
        className={cn("toast-timer absolute bottom-0 left-0 h-[3px] w-full origin-left", BAR[toast.tone])}
        style={{ animationDuration: `${toast.duration}ms` }}
        onAnimationEnd={() => notify.dismissToast(toast.id)}
      />
    </div>
  );
}

function AlertDialog({ alert }: { alert: Alert }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => notify.dismissAlert(alert.id);

  return (
    <dialog
      ref={ref}
      onClose={close}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
      aria-labelledby={`alert-${alert.id}-title`}
      aria-describedby={`alert-${alert.id}-message`}
      className="alert-dialog m-auto w-[min(520px,calc(100vw-24px))] max-h-[calc(100svh-24px)] overflow-auto rounded-[22px] border-0 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/45 backdrop:backdrop-blur-sm"
    >
      <div className={cn("grainy flex items-center gap-3 px-6 pt-6 pb-5", alert.tone === "error" ? "bg-red" : "bg-yellow")}>
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/85 text-ink" aria-hidden="true">
          {alert.tone === "error" ? <OctagonAlert className="size-5" /> : <AlertTriangle className="size-5" />}
        </span>
        <h2 id={`alert-${alert.id}-title`} className="display-h text-[clamp(26px,6vw,34px)] leading-[0.95]">
          {alert.title}
        </h2>
      </div>
      <div className="space-y-4 p-6">
        <p id={`alert-${alert.id}-message`} className="m-0 text-[16px] leading-relaxed">
          {alert.message}
        </p>
        {alert.detail && (
          <details className="rounded-[14px] bg-paper px-4 py-3 text-sm">
            <summary className="cursor-pointer font-semibold">Technical details</summary>
            <pre className="m-0 mt-3 max-h-56 overflow-auto font-mono text-xs whitespace-pre-wrap break-words text-ink/75">{alert.detail}</pre>
          </details>
        )}
        <div className="flex flex-wrap justify-end gap-3 pt-1">
          {alert.actions?.map((action) => (
            <PillButton
              key={action.label}
              tone="light"
              text={action.label}
              onClick={() => {
                close();
                action.onClick?.();
              }}
            />
          ))}
          <PillButton text="Close" onClick={close} autoFocus />
        </div>
      </div>
    </dialog>
  );
}

/** Renders the toast stack and, one at a time, alert pop-ups. Mount once. */
export function Notifier() {
  const { toasts, alerts } = useNotifications();
  const current = alerts[0];

  return (
    <>
      <ol
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-[max(16px,env(safe-area-inset-bottom))] left-4 z-[1100] m-0 flex list-none flex-col gap-2 p-0 sm:left-auto sm:w-[380px]"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.li
              key={t.id}
              layout
              className="pointer-events-auto"
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 48, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              <ToastCard toast={t} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {current && <AlertDialog key={current.id} alert={current} />}
    </>
  );
}
