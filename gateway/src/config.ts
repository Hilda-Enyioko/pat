import "dotenv/config";
import fs from "fs";
import path from "path";
import { Keypair } from "@solana/web3.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

export const config = {
  rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
  databaseUrl: need("DATABASE_URL"),
  keeper: Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(need("KEEPER_KEYPAIR"), "utf8")))
  ),
  pinPepper: need("PIN_PEPPER"),
  enrollToken: need("ENROLL_TOKEN"),
  idlPath: path.resolve(process.env.IDL_PATH ?? "../target/idl/pat.json"),
  port: Number(process.env.PORT ?? 3000),
  maxPinAttempts: 3,
  lockMinutes: 30,
};