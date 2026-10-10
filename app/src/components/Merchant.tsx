import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import nacl from "tweetnacl";
import localforage from "localforage";
import { payloadToIntent, serializeIntentSigningBytes, type SignedIntentPayload } from "../lib/intent";
import { shortKey } from "../lib/format";

const inbox = localforage.createInstance({ name: "pat", storeName: "merchantInbox" });
export function Merchant() {
  const { publicKey } = useWallet();
  const [raw, setRaw] = useState("");
  const [message, setMessage] = useState("");
  async function accept() {
    setMessage("");
    if (!publicKey) return setMessage("Connect the merchant wallet first.");
    try {
      const payload = JSON.parse(raw) as SignedIntentPayload;
      const intent = payloadToIntent(payload);
      if (!intent.merchant.equals(publicKey)) throw new Error("This payment is addressed to a different merchant wallet.");
      const signature = bs58.decode(payload.signature);
      if (!nacl.sign.detached.verify(serializeIntentSigningBytes(intent), signature, intent.payer.toBytes())) throw new Error("Signature verification failed.");
      if (Number(intent.expiresAt) < Math.floor(Date.now() / 1000)) throw new Error("This payment intent has expired.");
      const key = intent.paymentId.reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
      if (await inbox.getItem(key)) throw new Error("This payment has already been received.");
      await inbox.setItem(key, { payload, state: "OFFLINE_ACCEPTED", receivedAt: Date.now() });
      setMessage("Signature valid. Funds are only confirmed once you settle online.");
      setRaw("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid payment payload."); }
  }
  return <main className="workspace page-shell"><div className="workspace-heading"><div><p className="eyebrow">Merchant settlement</p><h1>Receive offline payments.</h1><p className="muted">Share your wallet address, then verify customer payloads without a network connection.</p></div><span className="offline-badge">Offline-ready</span></div><section className="card merchant-card"><h2>Your receiving address</h2><p className="address-echo">{publicKey ? shortKey(publicKey.toBase58()) : "Connect wallet to receive"}</p><button className="quiet-button" disabled={!publicKey} onClick={() => void navigator.clipboard?.writeText(publicKey?.toBase58() ?? "")}>Copy address</button><label>Paste customer .pat payload<textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder='{"v":1,"intent":...}' /></label><button className="primary-button" onClick={() => void accept()}>Verify and accept</button>{message && <p className="status" role="status">{message}</p>}<p className="muted">Accepted payments remain offline until the merchant reconnects and settles them on Solana.</p></section></main>;
}

