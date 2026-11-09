import { useState } from "react";
import { Phone, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { USSD_ENABLED } from "../config";
import type { Rail } from "../lib/ledger";
import { PageHeading } from "./site/PageHeading";
import { ReserveForm } from "./ReserveForm";
import { UssdReserveForm } from "./UssdReserveForm";

const RAILS: { rail: Rail; title: string; sub: string; icon: typeof QrCode }[] = [
  { rail: "qr", title: "Offline (QR)", sub: "Reserve SOL. Pay with no signal at all.", icon: QrCode },
  { rail: "ussd", title: "Phone (USSD)", sub: "Reserve a token. Pay by dialling a code on any phone.", icon: Phone },
];

export function ReservePage({
  online,
  onCreated,
  onGuide,
}: {
  online: boolean;
  onCreated: () => void;
  onGuide: (anchor?: string) => void;
}) {
  const [rail, setRail] = useState<Rail>(() => (USSD_ENABLED && window.location.hash === "#ussd" ? "ussd" : "qr"));

  const pick = (next: Rail) => {
    setRail(next);
    window.history.replaceState(null, "", next === "ussd" ? "#ussd" : window.location.pathname);
  };

  return (
    <main className="page">
      <PageHeading
        eyebrow="Step 2 / 3"
        lines={rail === "qr" ? ["Reserve", "offline", "funds."] : ["Reserve", "for your", "phone."]}
        lede={
          rail === "qr"
            ? "Lock a bounded allowance while connected. Unspent funds return after the settle window."
            : "Lock a token allowance, then link your phone and PIN. Pay by USSD with signal only."
        }
        aside={
          <span className="inline-flex items-center gap-2 self-end rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold">
            <span aria-hidden="true" className={online ? "size-2 rounded-full bg-[#3fb36b]" : "size-2 rounded-full bg-red"} />
            {online ? "Online" : "Offline"}
          </span>
        }
      />

      <div role="radiogroup" aria-label="Payment rail" className="mb-4 grid gap-3 sm:grid-cols-2">
        {RAILS.map(({ rail: r, title, sub, icon: Icon }) => {
          const unavailable = r === "ussd" && !USSD_ENABLED;
          const selected = rail === r;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={unavailable}
              onClick={() => pick(r)}
              className={cn(
                "flex cursor-pointer items-start gap-4 rounded-[22px] border p-5 text-left transition-shadow disabled:cursor-not-allowed disabled:opacity-55",
                selected ? "border-ink bg-white shadow-[0_0_0_2px_var(--ink)]" : "border-ink/10 bg-white/70",
              )}
            >
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", r === "qr" ? "bg-blue" : "bg-yellow")}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold">{title}</span>
                <span className="block text-sm text-muted-foreground">{unavailable ? "Coming soon: the USSD gateway isn't enabled in this build." : sub}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-0 mb-10 text-sm text-muted-foreground">
        Not sure which?{" "}
        <button type="button" onClick={() => onGuide("pick")} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-ink underline underline-offset-4">
          Read the payment guide
        </button>
        .
      </p>

      {rail === "qr" ? <ReserveForm onCreated={onCreated} /> : <UssdReserveForm online={online} onCreated={onCreated} />}
    </main>
  );
}
