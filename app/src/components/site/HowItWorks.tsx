import { useEffect, useRef, useState } from "react";
import { CheckCheck, CheckCircle2, Phone, QrCode, ShieldCheck, Vault, X } from "lucide-react";
import { USSD_ENABLED } from "@/config";
import { RAIL_INFO, type RailId } from "@/lib/rails";
import * as PricingCard from "@/components/ui/pricing-card";
import { cn } from "@/lib/utils";
import { PillButton } from "./Pill";

const ICONS = { qr: [<Vault key="a" />, <QrCode key="b" />, <ShieldCheck key="c" />], ussd: [<Vault key="a" />, <Phone key="b" />, <CheckCheck key="c" />] };

export function HowItWorks({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rail, setRail] = useState<RailId>("qr");
  const info = RAIL_INFO[rail];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="how-title"
      className="m-auto max-h-[calc(100svh-24px)] w-[min(1080px,calc(100vw-24px))] overflow-auto rounded-[22px] border-0 bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/45 backdrop:backdrop-blur-sm"
    >
      <div className="p-5 sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">How PAT works</p>
            <h2 id="how-title" className="display-h mt-2 text-[clamp(36px,6vw,64px)]">
              Reserve online.
              <br />
              Pay with any signal.
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-stone text-ink transition-colors hover:bg-ink hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        <div role="tablist" aria-label="Payment method" className="mb-5 inline-flex flex-wrap gap-1 rounded-full bg-white p-1">
          {(Object.keys(RAIL_INFO) as RailId[])
            .filter((id) => id === "qr" || USSD_ENABLED)
            .map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={rail === id}
                onClick={() => setRail(id)}
                className={cn(
                  "h-10 cursor-pointer rounded-full border-0 px-4 text-sm font-semibold",
                  rail === id ? "bg-ink text-white" : "bg-transparent text-ink",
                )}
              >
                {RAIL_INFO[id].label}
              </button>
            ))}
        </div>
        <p className="mt-0 mb-5 text-sm text-muted-foreground">{info.when}</p>

        <div className="grid gap-4 md:grid-cols-3">
          {info.steps.map((step, i) => (
            <PricingCard.Card key={step.name} className="max-w-none rounded-[22px] bg-white p-1.5 shadow-none">
              <PricingCard.Header className={cn("grainy mb-2 rounded-[18px] border-0", step.tile)} glassEffect={false}>
                <PricingCard.Plan>
                  <PricingCard.PlanName className="text-ink">
                    {ICONS[rail][i]}
                    <span>{step.name}</span>
                  </PricingCard.PlanName>
                  <PricingCard.Badge className="border-ink/25 bg-white/50 text-ink">{step.badge}</PricingCard.Badge>
                </PricingCard.Plan>
                <PricingCard.Price className="mb-0">
                  <PricingCard.MainPrice className="font-display text-[56px] font-black uppercase leading-[0.9] tracking-[-0.05em] [font-stretch:85%]">
                    {step.word}
                  </PricingCard.MainPrice>
                </PricingCard.Price>
              </PricingCard.Header>
              <PricingCard.Body>
                <PricingCard.Description className="text-sm text-ink">{step.description}</PricingCard.Description>
                <PricingCard.List>
                  {step.points.map((point) => (
                    <PricingCard.ListItem key={point}>
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden="true" />
                      <span>{point}</span>
                    </PricingCard.ListItem>
                  ))}
                </PricingCard.List>
              </PricingCard.Body>
            </PricingCard.Card>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[18px] bg-white px-5 py-4">
          <p className="m-0 max-w-xl text-sm text-muted-foreground">
            {info.note}
          </p>
          <PillButton
            text="Get started"
            onClick={() => {
              onClose();
              onStart();
            }}
          />
        </div>
      </div>
    </dialog>
  );
}
