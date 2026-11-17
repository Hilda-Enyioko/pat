import { Phone } from "lucide-react";
import { USSD_SANDBOX, USSD_SERVICE_CODE } from "@/config";
import { dialHref } from "@/lib/gateway";
import { cn } from "@/lib/utils";

/**
 * The USSD dial code with a tap-to-dial button. On a phone, tapping opens the dialler
 * with the code filled in. The sandbox notice shows while it only works in the simulator.
 */
export function DialCode({ className, label = "Dial to pay" }: { className?: string; label?: string }) {
  return (
    <div className={cn("grainy on-dark rounded-[18px] bg-card-dark p-5 text-white", className)}>
      <p className="m-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/60">
        <Phone className="size-3.5" aria-hidden="true" /> {label}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="m-0 font-mono text-[clamp(28px,6vw,40px)] font-medium tracking-tight">{USSD_SERVICE_CODE}</p>
        <a
          href={dialHref(USSD_SERVICE_CODE)}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-ink no-underline"
        >
          <Phone className="size-4" aria-hidden="true" /> Dial
        </a>
      </div>
      {USSD_SANDBOX && (
        <p className="m-0 mt-3 inline-flex rounded-full bg-yellow px-3 py-1 text-xs font-semibold text-ink">
          Sandbox: dial it in the Africa&rsquo;s Talking simulator, not on a real phone yet.
        </p>
      )}
    </div>
  );
}
