import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import fs from "fs";
import os from "os";
import path from "path";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint,
  getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo,
} from "@solana/spl-token";
import { config } from "../src/config";
import { connection, idl, merchantPda } from "../src/chain";

const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(
  process.env.OWNER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
const phone = process.env.SEED_PHONE ?? "+2348000000000";
const pin = process.env.SEED_PIN ?? "1234";
const symbol = process.env.SEED_SYMBOL ?? "USDC";
const merchantCode = Number(process.env.MERCHANT_CODE ?? 4242);
// Point at your Render URL to seed the deployed gateway, e.g. https://pat-gateway.onrender.com
const gatewayUrl = (process.env.GATEWAY_URL ?? `http://localhost:${config.port}`).replace(/\/$/, "");
const DECIMALS = 6;
const unit = 10n ** BigInt(DECIMALS);

const prog: any = new anchor.Program(
  idl, new anchor.AnchorProvider(connection, new anchor.Wallet(owner), { commitment: "confirmed" }));

async function main() {
  const lamports = await connection.getBalance(owner.publicKey);
  if (lamports < 0.1 * 1e9) {
    throw new Error(`Owner ${owner.publicKey.toBase58()} has ${lamports / 1e9} SOL; fund it first.`);
  }

  const mint = await createMint(connection, owner, owner.publicKey, null, DECIMALS);
  const ownerAta = await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey);
  await mintTo(connection, owner, mint, ownerAta.address, owner, 1_000n * unit);

  const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], prog.programId)[0];
  if (!(await connection.getAccountInfo(configPda))) {
    await prog.methods.initConfig()
      .accountsPartial({ admin: owner.publicKey, config: configPda, systemProgram: SystemProgram.programId })
      .rpc();
  }

  let payout: PublicKey;
  const existing = await prog.account.merchant.fetchNullable(merchantPda(merchantCode));
  if (existing) {
    payout = existing.payout;
  } else {
    payout = Keypair.generate().publicKey;
    await prog.methods.registerMerchant(merchantCode, payout)
      .accountsPartial({
        admin: owner.publicKey, config: configPda,
        merchantEntry: merchantPda(merchantCode), systemProgram: SystemProgram.programId,
      }).rpc();
  }

  const id = new BN(Date.now());
  const reservation = PublicKey.findProgramAddressSync(
    [Buffer.from("reservation"), owner.publicKey.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    prog.programId)[0];
  const vault = getAssociatedTokenAddressSync(mint, reservation, true);

  const sig = await prog.methods
    .reserveDelegated(
      id, new BN((100n * unit).toString()), new BN((25n * unit).toString()),
      new BN(Math.floor(Date.now() / 1000) + 86_400), 20, config.keeper.publicKey)
    .accountsPartial({
      owner: owner.publicKey, reservation, mint, ownerTokenAccount: ownerAta.address, vault,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).rpc({ commitment: "confirmed" });

  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");

  const res = await fetch(`${gatewayUrl}/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-enroll-token": config.enrollToken },
    body: JSON.stringify({ phone, reservation: reservation.toBase58(), pin, symbol }),
  });
  console.log("enroll:", res.status, await res.text());
  console.log({ mint: mint.toBase58(), reservation: reservation.toBase58(),
    merchantCode, merchantPayout: payout.toBase58(), phone, pin });
}
main().catch((e) => { console.error(e); process.exit(1); });
