import { PublicKey } from "@solana/web3.js";
import {
  buildIntent,
  serializeIntentSigningBytes,
  bytesToHex,
} from "./src/lib/intent.js";

const goldenIntent = buildIntent({
  cluster: 1,
  paymentId: new Uint8Array(32).fill(1),
  payer: new PublicKey(new Uint8Array(32).fill(2)),
  merchant: new PublicKey(new Uint8Array(32).fill(3)),
  reservation: new PublicKey(new Uint8Array(32).fill(4)),
  amount: 250_000_000n,
  createdAt: 1_700_000_000n,
  expiresAt: 1_700_003_600n,
  sequence: 5,
  committedAfter: 750_000_000n,
});

console.log(bytesToHex(serializeIntentSigningBytes(goldenIntent)));
