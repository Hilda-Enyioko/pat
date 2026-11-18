import { useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { DEV_ENROLL_TOKEN } from "../config";
import { devEnroll, enrollMessage, finishPhoneLink, startPhoneLink, type PhoneLink } from "../lib/gateway";
import { patchLedger } from "../lib/ledger";
import { notify, reportError } from "../lib/notify";
import { PillButton } from "./site/Pill";
import { StatusNote } from "./site/StatusNote";
import { DialCode } from "./site/DialCode";
import { DialToLink, maskPhone, normalizePhone, PhonePinFields, validatePhonePin, type PhonePin, type PhonePinErrors } from "./PhoneLink";

type Stage = "details" | "dial" | "sign" | "done";

/**
 * Links a phone + PIN to a reservation that already exists (the Ledger's "Link phone").
 * New USSD reservations do this inside the reserve flow instead, with one wallet approval.
 *   phone + PIN -> dial the USSD code and enter the link code -> wallet signs a message -> done
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
  const [form, setForm] = useState<PhonePin>({ phone: "", pin: "", pin2: "" });
  const [errors, setErrors] = useState<PhonePinErrors>({});
  const [link, setLink] = useState<PhoneLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [enrolledAs, setEnrolledAs] = useState("");

  const devMode = Boolean(DEV_ENROLL_TOKEN);
  const canSign = typeof signMessage === "function";
  const phone = normalizePhone(form.phone);

  async function finish(masked: string) {
    setForm({ phone: "", pin: "", pin2: "" });
    setLink(null);
    setEnrolledAs(masked);
    setStage("done");
    await patchLedger(reservation, { enrolled: true, phoneMasked: masked }).catch(() => undefined);
    notify.success("Phone linked", `${masked} can now pay over USSD.`);
    onEnrolled?.(masked);
  }

  async function onDetails() {
    const e = validatePhonePin(form);
    setErrors(e);
    if (Object.keys(e).length || !publicKey) return;
    setBusy(true);
    try {
      if (devMode) {
        setStatus("Linking (dev mode)…");
        await devEnroll({ phone, reservation, pin: form.pin, symbol });
        await finish(maskPhone(phone));
        return;
      }
      setLink(await startPhoneLink(phone, publicKey.toBase58()));
      setStage("dial");
    } catch (err) {
      reportError(err, { title: "Couldn't start linking" });
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }

  async function onSign() {
    if (!link || !signMessage) return;
    setBusy(true);
    try {
      setStatus("Sign the message in your wallet…");
      const sig = await signMessage(new TextEncoder().encode(enrollMessage(link.linkId, phone, reservation)));
      setStatus("Finishing…");
      const res = await finishPhoneLink({ linkId: link.linkId, reservation, pin: form.pin, signature: bs58.encode(sig) });
      await finish(res.phoneMasked);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "link_expired" || code === "link_used") {
        setStage("details");
        setLink(null);
      }
      reportError(err, { title: "Linking failed" });
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }

  if (stage === "done") {
    return (
      <div className="space-y-4">
        <StatusNote tone="success">
          {enrolledAs} is linked. Dial the code below on that phone, choose 1 to pay, then enter the merchant code,
          amount and your PIN.
        </StatusNote>
        <DialCode />
      </div>
    );
  }

  const disabled = busy || !online;

  return (
    <div className="space-y-5">
      {!online && <StatusNote tone="warning">Linking needs the network. Switch to online to continue.</StatusNote>}
      {!publicKey && <StatusNote tone="warning">Connect the wallet that owns this reservation.</StatusNote>}

      {stage === "details" && (
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onDetails();
          }}
        >
          <PhonePinFields idPrefix="enroll" value={form} onChange={setForm} errors={errors} disabled={disabled} />
          <ul className="m-0 space-y-1 pl-5 text-sm text-muted-foreground sm:col-span-2">
            <li>One phone number pays from one reservation. Linking it again moves it here.</li>
            <li>Your PIN approves every USSD payment. Don&rsquo;t share it.</li>
          </ul>
          {devMode && (
            <StatusNote tone="warning" className="sm:col-span-2">
              Dev mode: no dial-in or wallet signature. Local testing only.
            </StatusNote>
          )}
          <PillButton
            type="submit"
            text={busy ? "Working…" : devMode ? "Link phone" : "Next: confirm the phone"}
            disabled={disabled || !publicKey}
            className="sm:col-span-2 sm:justify-self-start"
          />
        </form>
      )}

      {stage === "dial" && link && (
        <DialToLink
          link={link}
          phone={phone}
          onVerified={() => setStage("sign")}
          onRestart={() => {
            setLink(null);
            setStage("details");
          }}
        />
      )}

      {stage === "sign" && link && (
        <div className="space-y-4">
          <StatusNote tone="success">{maskPhone(phone)} is confirmed.</StatusNote>
          <p className="m-0 text-sm text-muted-foreground">
            Last step: your wallet signs a short message that proves you own this reservation. It is not a transaction
            and costs nothing.
          </p>
          {!canSign && (
            <StatusNote tone="warning">
              This wallet can&rsquo;t sign messages (common with Ledger-backed accounts). Use Phantom or Solflare.
            </StatusNote>
          )}
          <PillButton type="button" text={busy ? "Working…" : "Sign and finish"} disabled={disabled || !canSign} onClick={() => void onSign()} />
        </div>
      )}

      {status && <StatusNote>{status}</StatusNote>}
    </div>
  );
}
