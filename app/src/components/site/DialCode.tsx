import { Phone } from "lucide-react";
import { USSD_SANDBOX, USSD_SERVICE_CODE } from "@/config";
import { cn } from "@/lib/utils";

/** The USSD dial code, always with the sandbox notice when it only works in the simulator. */
export function DialCode({ className }: { className?: string }) {
  return (
    <div className={cn("grainy on-dark rounded-[18px] bg-card-dark p-5 text-white", className)}>
      <p className="m-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/60">
        <Phone className="size-3.5" aria-hidden="true" /> Dial to pay
      </p>
      <p className="m-0 mt-3 font-mono text-[clamp(28px,6vw,40px)] font-medium tracking-tight">{USSD_SERVICE_CODE}</p>
      {USSD_SANDBOX && (
        <p className="m-0 mt-3 inline-flex rounded-full bg-yellow px-3 py-1 text-xs font-semibold text-ink">
          Demo / sandbox: works only in the Africa&rsquo;s Talking simulator, not on a real phone.
        </p>
      )}
    </div>
  );
}
