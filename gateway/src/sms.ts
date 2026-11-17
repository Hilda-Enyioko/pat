import { config } from "./config";

/**
 * Africa's Talking SMS. With AT_USERNAME=sandbox the message lands in the
 * sandbox simulator, not on a real phone. Without credentials it only logs.
 * A failed SMS never fails the payment: the Payment PDA is the receipt.
 */
export async function notify(phone: string, text: string) {
  const { username, apiKey, senderId } = config.at;
  if (!username || !apiKey) {
    console.log(`[SMS (not configured) -> ${phone}] ${text}`);
    return;
  }
  const host = username === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
  const body = new URLSearchParams({ username, to: phone, message: text });
  if (senderId) body.set("from", senderId);
  try {
    const res = await fetch(`https://${host}/version1/messaging`, {
      method: "POST",
      headers: { apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[SMS] ${phone}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    else {
      const out = (await res.json().catch(() => null)) as any;
      const status = out?.SMSMessageData?.Recipients?.[0]?.status;
      if (status && status !== "Success") console.error(`[SMS] ${phone}: ${status}`);
    }
  } catch (e) {
    console.error(`[SMS] ${phone}: ${e instanceof Error ? e.message : e}`);
  }
}
