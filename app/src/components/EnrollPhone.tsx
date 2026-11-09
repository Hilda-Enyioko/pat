import { useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { DEV_ENROLL_TOKEN } from "../config";
import {
  confirmEnrollment,
  devEnroll,
  PHONE_RE,
  requestChallenge,
  validPinFormat,
  type Challenge,
} from "../lib/gateway";
import { patchLedger } from "../lib/ledger";
import { notify, reportError } from "../lib/notify";
import { Field, inputClass } from "./site/Field";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";
import { DialCode } from "./site/DialCode";

type Stage = "details" | "otp" | "done";

const maskPhone = (p: string) => (p.length > 8 ? `${p.slice(0, 4)}${"*".repeat(p.length - 8)}${p.slice(-4)}` : p);

/**
 * Enrolls a phone number and PIN against a USSD reservation:
 * phone + PIN -> SMS code -> wallet signs the gateway's challenge -> confirm.
 * The PIN only lives in this component's state and is cleared after submit.
 */
export function EnrollPhone({
  reservation,
  symbol,
  online,
  onEnrolled,
}: {
  reservation: string;
  symbol: string;
  online: boolean;
  onEnrolled?: (phoneMasked: string) => void;
}) {
  const { publicKey, signMessage } = useWallet();
  const [stage, setStage] = useState<Stage>("details");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [otp, setOtp] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [replaceOk, setReplaceOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ phone?: string; pin?: string; pin2?: string; otp?: string }>({});
  const [enrolledAs, setEnrolledAs] = useState("");

  const devMode = Boolean(DEV_ENROLL_TOKEN);
  const canSign = typeof signMessage === "function";

  function validateDetails() {
    const next: typeof errors = {};
    const p = phone.replace(/[\s-]/g, "");
    if (!PHONE_RE.test(p)) next.phone = "Use international format: + then 8 to 15 digits, like +2348012345678.";
    if (!validPinFormat(pin)) next.pin = "Exactly 4 digits.";
    else if (pin !== pin2) next.pin2 = "The two PINs don't match.";
    setErrors(next);
    return Object.keys(next).length === 0 ? p : null;
  }

  async function finish(masked: string) {
    setPin("");
    setPin2("");
    setOtp("");
    setChallenge(null);
    setEnrolledAs(masked);
    setStage("done");
    await patchLedger(reservation, { enrolled: true, phoneMasked: masked }).catch(() => undefined);
    notify.success("Phone enrolled", `${masked} can now pay over USSD.`);
    onEnrolled?.(masked);
  }

  async function onDetails() {
    const p = validateDetails();
    if (!p) return;
    setBusy(true);
    try {
      if (devMode) {
        setStatus("Enrolling (dev mode)…");
        await devEnroll({ phone: p, reservation, pin, symbol });
        setPhone(p);
        await finish(maskPhone(p));
        return;
      }
      setStatus("Asking the gateway to text you a code…");
      const c = await requestChallenge(p, reservation);
      setPhone(p);
      setChallenge(c);
      setReplaceOk(!c.phoneAlreadyEnrolled);
      setStage("otp");
      notify.info("Code sent", `We texted a code to ${maskPhone(p)}.`);
    } catch (e) {
      reportError(e, { title: "Couldn't start enrollment" });
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }

  async function onConfirm() {
    if (!challenge) return;
    if (!/^\d{4,8}$/.test(otp.trim())) {
      setErrors({ otp: "Enter the code from the SMS." });
      return;
    }
    if (!replaceOk) {
      notify.warning("Confirm the replacement", "Tick the box to move this phone to this reservation.");
      return;
    }
    if (!canSign || !signMessage) {
      notify.warning("Wallet can't sign messages", "Use Phantom or Solflare to enroll a phone.");
      return;
    }
    if (challenge.expiresAt * 1000 < Date.now()) {
      notify.warning("Request expired", "Start again to get a new code.");
      setStage("details");
      setChallenge(null);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      setStatus("Sign the enrollment message in your wallet…");
      const sig = await signMessage(new TextEncoder().encode(challenge.message));
      setStatus("Confirming with the gateway…");
      const res = await confirmEnrollment({
        challengeId: challenge.challengeId,
        otp: otp.trim(),
        pin,
        signature: bs58.encode(sig),
      });
      await finish(res.phoneMasked ?? maskPhone(phone));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "challenge_expired" || code === "challenge_used" || code === "too_many_attempts") {
        setStage("details");
        setChallenge(null);
        setOtp("");
      }
      reportError(e, { title: "Enrollment failed" });
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }

  if (stage === "done") {
    return (
      <div className="space-y-4">
        <StatusNote tone="success">
          {enrolledAs} is enrolled. Dial the code below on that phone, choose 1 to pay, then enter the merchant code,
          amount and your PIN.
        </StatusNote>
        <DialCode />
      </div>
    );
  }

  const disabled = busy || !online;

  return (
    <div className="space-y-5">
      {!online && <StatusNote tone="warning">Enrollment needs the network. Switch to online to continue.</StatusNote>}
      {!publicKey && <StatusNote tone="warning">Connect the wallet that owns this reservation.</StatusNote>}

      {stage === "details" && (
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onDetails();
          }}
        >
          <div className="sm:col-span-2">
            <Field id="enroll-phone" label="Phone number" error={errors.phone} hint="International format, with the + and country code.">
              <input
                id="enroll-phone"
                className={inputClass}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+2348012345678"
                inputMode="tel"
                autoComplete="tel"
                aria-invalid={Boolean(errors.phone)}
                disabled={disabled}
              />
            </Field>
          </div>
          <Field id="enroll-pin" label="PIN (4 digits)" error={errors.pin}>
            <input
              id="enroll-pin"
              className={inputClass}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              aria-invalid={Boolean(errors.pin)}
              disabled={disabled}
            />
          </Field>
          <Field id="enroll-pin2" label="Confirm PIN" error={errors.pin2}>
            <input
              id="enroll-pin2"
              className={inputClass}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
              aria-invalid={Boolean(errors.pin2)}
              disabled={disabled}
            />
          </Field>
          <ul className="m-0 space-y-1 pl-5 text-sm text-muted-foreground sm:col-span-2">
            <li>One phone number pays from one reservation. Enrolling it again moves it to the new reservation.</li>
            <li>On this rail the PIN guards the money, not a key you hold. Don&rsquo;t share it.</li>
          </ul>
          {devMode && (
            <StatusNote tone="warning" className="sm:col-span-2">
              Dev enrollment mode: no SMS code or wallet signature. Local testing only.
            </StatusNote>
          )}
          <PillButton
            type="submit"
            text={busy ? "Working…" : devMode ? "Enroll phone" : "Text me a code"}
            disabled={disabled || !publicKey}
            className="sm:col-span-2 sm:justify-self-start"
          />
        </form>
      )}

      {stage === "otp" && challenge && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void onConfirm();
          }}
        >
          {challenge.phoneAlreadyEnrolled && (
            <label className="flex items-start gap-3 rounded-[14px] bg-yellow/55 px-4 py-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-ink"
                checked={replaceOk}
                onChange={(e) => setReplaceOk(e.target.checked)}
                disabled={busy}
              />
              <span>
                {maskPhone(phone)} is already enrolled to another reservation. Confirming moves it here, and the old
                reservation stops accepting USSD payments.
              </span>
            </label>
          )}
          <Field id="enroll-otp" label="Code from the SMS" error={errors.otp} hint={`Sent to ${maskPhone(phone)}.`}>
            <input
              id="enroll-otp"
              className={inputClass}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              aria-invalid={Boolean(errors.otp)}
              disabled={disabled}
            />
          </Field>
          {!canSign && (
            <StatusNote tone="warning">
              This wallet can&rsquo;t sign messages (common with Ledger-backed accounts and some mobile wallets). Use
              Phantom or Solflare to enroll.
            </StatusNote>
          )}
          <p className="m-0 text-sm text-muted-foreground">
            Next, your wallet signs a short message. It proves you own the reservation. It is not a transaction and
            costs nothing.
          </p>
          <div className="flex flex-wrap gap-3">
            <PillButton type="submit" text={busy ? "Working…" : "Confirm enrollment"} disabled={disabled || !canSign} />
            <PillButton
              type="button"
              tone="light"
              text="Start over"
              disabled={busy}
              onClick={() => {
                setStage("details");
                setChallenge(null);
                setOtp("");
              }}
            />
          </div>
        </form>
      )}

      {status && <StatusNote>{status}</StatusNote>}
    </div>
  );
}

