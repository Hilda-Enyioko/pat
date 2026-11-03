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
  pinPepper: need("PIN_PEPPER"),
  enrollToken: need("ENROLL_TOKEN"),
  idlPath: resolveIdl(),
  port: Number(process.env.PORT ?? 3000),
  maxPinAttempts: 3,
  lockMinutes: 30,
};
