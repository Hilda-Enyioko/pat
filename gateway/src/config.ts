import "dotenv/config";
import fs from "fs";
import path from "path";
import { Keypair } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

/**
 * A secret key as either a JSON byte array "[12,34,...]" (solana-keygen files) or a
 * base58 string (what Phantom/Solflare "export private key" gives). Quotes and
 * whitespace pasted into a dashboard are ignored.
 */
function parseSecretKey(raw: string, name: string): Keypair {
  const v = raw.trim().replace(/^['"]|['"]$/g, "").trim();
  try {
    const bytes = v.startsWith("[") ? Uint8Array.from(JSON.parse(v)) : utils.bytes.bs58.decode(v);
    return Keypair.fromSecretKey(bytes);
  } catch (e) {
    throw new Error(
      `${name} is not a valid secret key. Use a JSON array like [12,34,...] (64 numbers) or a base58 private key. (${e instanceof Error ? e.message : e})`,
    );
  }
}

function loadKeeper(): Keypair {
  // Render: set KEEPER_KEYPAIR_JSON. Local: KEEPER_KEYPAIR=/path/to/file.json
  const env = process.env.KEEPER_KEYPAIR_JSON?.trim();
  if (env) return parseSecretKey(env, "KEEPER_KEYPAIR_JSON");
  return parseSecretKey(fs.readFileSync(need("KEEPER_KEYPAIR"), "utf8"), "KEEPER_KEYPAIR");
}

/**
 * Optional: the on-chain Config admin, needed only to activate merchant codes.
 * A bad value turns activation off instead of taking USSD payments down with it.
 */
function loadAdmin(): Keypair | null {
  try {
    const env = process.env.ADMIN_KEYPAIR_JSON?.trim();
    if (env) return parseSecretKey(env, "ADMIN_KEYPAIR_JSON");
    const file = process.env.ADMIN_KEYPAIR?.trim();
    return file ? parseSecretKey(fs.readFileSync(file, "utf8"), "ADMIN_KEYPAIR") : null;
  } catch (e) {
    console.error(`[config] ${e instanceof Error ? e.message : e} Merchant activation is OFF.`);
    return null;
  }
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
  // Either name works: RPC_URL is the documented one, VITE_RPC_URL matches the app.
  rpcUrl: process.env.RPC_URL || process.env.VITE_RPC_URL || "https://api.devnet.solana.com",
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
