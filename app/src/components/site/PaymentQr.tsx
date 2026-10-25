import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { X } from "lucide-react";
import { lamportsToSol } from "../../lib/format";
import { notify } from "../../lib/notify";
import { PillButton } from "./Pill";

export interface ShownPayment {
  payload: string;
  amount: bigint;
  /** Hex payment id. */
  paymentId: string;
  sequence: number;
}

/** The signed payment as the merchant scans it: QR, amount, copy and download. */
export function PaymentQr({ payment }: { payment: ShownPayment }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payment.payload);
      setCopied(true);
      notify.success("Payload copied", undefined, { key: "copy" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.warning("Couldn't copy", "Your browser blocked the clipboard. Use Download .pat instead.");
    }
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([payment.payload], { type: "application/json" }));
    a.download = `${payment.paymentId}.pat`;
    a.click();
  };

  return (
    <>
      <div className="rounded-[18px] border border-ink/10 bg-white p-3">
        <QRCodeCanvas value={payment.payload} size={260} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0f0f0e" className="block h-auto max-w-full" />
      </div>
      <p className="m-0 text-center font-display text-4xl font-black uppercase leading-none tracking-tighter font-stretch-85%">
        {lamportsToSol(payment.amount)} SOL
      </p>
      <p className="m-0 font-mono text-xs text-muted-foreground">
        Payment {payment.paymentId.slice(0, 8)}… · sequence {payment.sequence}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <PillButton type="button" size="sm" tone="light" text={copied ? "Copied!" : "Copy payload"} onClick={() => void copy()} />
        <PillButton type="button" size="sm" tone="light" text="Download .pat" onClick={download} />
      </div>
    </>
  );
}

/** Reopens a signed payment that hasn't settled yet, so the payer can show it again. */
export function PaymentQrDialog({ payment, onClose }: { payment: ShownPayment | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (payment && !dialog.open) dialog.showModal();
    if (!payment && dialog.open) dialog.close();
  }, [payment]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-label="Signed payment"
      className="m-auto max-h-[calc(100svh-24px)] w-[min(420px,calc(100vw-24px))] overflow-auto rounded-[22px] border-0 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/45 backdrop:backdrop-blur-sm"
    >
      {payment && (
        <div className="flex flex-col items-center gap-5 p-5 sm:p-8">
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Show to merchant</span>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-yellow px-2.5 py-0.5 text-[11px] font-semibold">SIGNED</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-stone text-ink transition-colors hover:bg-ink hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <PaymentQr payment={payment} />
        </div>
      )}
    </dialog>
  );
}
