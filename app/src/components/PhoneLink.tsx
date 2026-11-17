import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Phone } from "lucide-react";
import { USSD_SANDBOX } from "../config";
import { dialHref, linkStatus, PHONE_RE, validPinFormat, type PhoneLink } from "../lib/gateway";
import { Field, inputClass } from "./site/Field";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";

export const maskPhone = (p: string) => (p.length > 8 ? `${p.slice(0, 4)}${"*".repeat(p.length - 8)}${p.slice(-4)}` : p);

export interface PhonePin {
  phone: string;
  pin: string;
  pin2: string;
}
export type PhonePinErrors = Partial<Record<keyof PhonePin, string>>;

export const normalizePhone = (p: string) => p.replace(/[\s-]/g, "");

export function validatePhonePin(v: PhonePin): PhonePinErrors {
  const e: PhonePinErrors = {};
  if (!PHONE_RE.test(normalizePhone(v.phone))) e.phone = "Use international format: + then 8 to 15 digits, like +2348012345678.";
  if (!validPinFormat(v.pin)) e.pin = "Exactly 4 digits.";
  else if (v.pin !== v.pin2) e.pin2 = "The two PINs don't match.";
  return e;
}

/** Phone number + 4-digit PIN (twice). The PIN lives only in component state. */
export function PhonePinFields({
  value,
  onChange,
  errors,
  disabled,
  idPrefix,
}: {
  value: PhonePin;
  onChange: (v: PhonePin) => void;
  errors: PhonePinErrors;
  disabled?: boolean;
  idPrefix: string;
}) {
  const set = (k: keyof PhonePin, v: string) => onChange({ ...value, [k]: v });
  return (
    <>
      <div className="sm:col-span-2">
        <Field id={`${idPrefix}-phone`} label="Phone number that will pay" error={errors.phone} hint="International format, with the + and country code.">
          <input
            id={`${idPrefix}-phone`}
            className={inputClass}
            value={value.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+2348012345678"
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={Boolean(errors.phone)}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field id={`${idPrefix}-pin`} label="Choose a 4-digit PIN" error={errors.pin} hint="You type it on the phone to approve each payment.">
        <input
          id={`${idPrefix}-pin`}
          className={inputClass}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={value.pin}
          onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))}
          aria-invalid={Boolean(errors.pin)}
          disabled={disabled}
        />
      </Field>
      <Field id={`${idPrefix}-pin2`} label="Confirm PIN" error={errors.pin2}>
        <input
          id={`${idPrefix}-pin2`}
          className={inputClass}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={value.pin2}
          onChange={(e) => set("pin2", e.target.value.replace(/\D/g, ""))}
          aria-invalid={Boolean(errors.pin2)}
          disabled={disabled}
        />
      </Field>
    </>
  );
}

/**
 * "Dial this, enter that": proves the phone is yours. Polls the gateway until the
 * phone has dialled in with the link code, then calls onVerified.
 */
export function DialToLink({
  link,
  phone,
  onVerified,
  onRestart,
}: {
  link: PhoneLink;
  phone: string;
  onVerified: () => void;
  onRestart: () => void;
}) {
  const [state, setState] = useState<"waiting" | "verified" | "expired">("waiting");

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await linkStatus(link.linkId);
        if (stop) return;
        if (s.verified) {
          setState("verified");
          onVerified();
          return;
        }
        if (s.expired || s.used) {
          setState("expired");
          return;
        }
      } catch {
        /* transient: keep polling */
      }
      if (!stop) timer = window.setTimeout(tick, 2500);
    };
    timer = window.setTimeout(tick, 1500);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // onVerified is a fresh closure each render; the link id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.linkId]);

  const digits = link.linkCode.split("");

  return (
    <div className="space-y-5">
      {link.phoneAlreadyEnrolled && (
        <StatusNote tone="warning">
          {maskPhone(phone)} already pays from another reservation. Finishing moves it here; the old one stops working
          over USSD.
        </StatusNote>
      )}
      <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
        <li className="rounded-[18px] bg-paper p-5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">1 · On {maskPhone(phone)}, dial</span>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="font-mono text-3xl font-medium">{link.serviceCode}</span>
            <a href={dialHref(link.serviceCode)} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-white no-underline">
              <Phone className="size-4" aria-hidden="true" /> Dial
            </a>
          </div>
          <span className="mt-2 block text-sm text-muted-foreground">Then choose &ldquo;Link this phone&rdquo;.</span>
        </li>
        <li className="rounded-[18px] bg-paper p-5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">2 · Enter this link code</span>
          <div className="mt-3 flex gap-1.5" aria-label={`Link code ${link.linkCode}`}>
            {digits.map((d, i) => (
              <span key={i} className="grid h-12 w-10 place-items-center rounded-[10px] bg-white font-mono text-2xl font-semibold shadow-sm">
                {d}
              </span>
            ))}
          </div>
          <span className="mt-2 block text-sm text-muted-foreground">It works once and expires in 20 minutes.</span>
        </li>
      </ol>
      {USSD_SANDBOX && (
        <p className="m-0 text-sm text-muted-foreground">
          Sandbox: open the Africa&rsquo;s Talking simulator, use the number {phone}, and dial {link.serviceCode} there.
        </p>
      )}
      {state === "waiting" && (
        <p className="m-0 flex items-center gap-2 text-sm font-semibold" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Waiting for your phone to dial in…
        </p>
      )}
      {state === "verified" && (
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-[#1f7a4a]" role="status">
          <CheckCircle2 className="size-4" aria-hidden="true" /> Phone confirmed.
        </p>
      )}
      {state === "expired" && (
        <StatusNote tone="warning">This link code has expired or was used up. Start again to get a new one.</StatusNote>
      )}
      {state !== "verified" && <PillButton type="button" tone="light" size="sm" text="Start over" onClick={onRestart} />}
    </div>
  );
}
