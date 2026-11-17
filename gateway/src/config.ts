import "dotenv/config";
import fs from "fs";
import path from "path";
import { Keypair } from "@solana/web3.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

function loadKeeper(): Keypair {
  // Render: set KEEPER_KEYPAIR_JSON to the JSON array. Local: KEEPER_KEYPAIR=/path/to/file.json
  const raw = process.env.KEEPER_KEYPAIR_JSON ?? fs.readFileSync(need("KEEPER_KEYPAIR"), "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

/** Optional: the on-chain Config admin. Needed only to activate merchant codes. */
function loadAdmin(): Keypair | null {
  const raw = process.env.ADMIN_KEYPAIR_JSON ?? (process.env.ADMIN_KEYPAIR ? fs.readFileSync(process.env.ADMIN_KEYPAIR, "utf8") : null);
  return raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : null;
}

function resolveIdl(): string {
  const candidates = [process.env.IDL_PATH, "./idl/pat.json", "../target/idl/pat.json"]
    .filter((p): p is string => !!p)
    .map((p) => path.resolve(p));
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`IDL not found. Tried:\n${candidates.join("\n")}`);
  return found;
}

export const config = {
  rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
  databaseUrl: need("DATABASE_URL"),
  keeper: loadKeeper(),
  admin: loadAdmin(),
  pinPepper: need("PIN_PEPPER"),
  enrollToken: need("ENROLL_TOKEN"),
  idlPath: resolveIdl(),
  port: Number(process.env.PORT ?? 3000),
  maxPinAttempts: 3,
  lockMinutes: 30,
  cluster: process.env.CLUSTER ?? "devnet",
  /** Tokens offered in the PWA, "MINT:SYMBOL,MINT:SYMBOL". Decimals are read from chain. */
  mints: (process.env.MINTS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [mint, symbol = "USDC"] = x.split(":");
      return { mint: mint.trim(), symbol: symbol.trim() };
    }),
  /** Browser origins allowed to call /meta and /enroll/*. "*" allows any. */
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((x) => x.trim()).filter(Boolean),
  /** USSD service code shown to users, e.g. the Africa's Talking sandbox code. */
  serviceCode: process.env.USSD_SERVICE_CODE ?? "*384*50549#",
  at: {
    username: process.env.AT_USERNAME ?? "",
    apiKey: process.env.AT_API_KEY ?? "",
    senderId: process.env.AT_SENDER_ID ?? "",
  },
  /** How long a phone-link session stays open (start -> dial -> reserve -> finish). */
  linkMinutes: 20,
  linkMaxAttempts: 5,
  linksPerPhonePer10Min: 3,
};
