import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "fs";

const PAYER_FILE = "payer.json";
const STATE_FILE = "state.json";
const MIN_WAIT_MS = 5 * 60 * 1000;

// 1. Connect to devnet
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// 2. Generate/load payer keypair (payer is also the nonce authority)
function loadOrCreatePayer(): Keypair {
  if (fs.existsSync(PAYER_FILE)) {
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_FILE, "utf8")));
    return Keypair.fromSecretKey(secret);
  }
  const kp = Keypair.generate();
  fs.writeFileSync(PAYER_FILE, JSON.stringify(Array.from(kp.secretKey)));
  console.log("Generated new payer:", kp.publicKey.toBase58());
  return kp;
}

async function ensureFunded(payer: Keypair) {
  const bal = await connection.getBalance(payer.publicKey);
  console.log("Payer balance:", bal / LAMPORTS_PER_SOL, "SOL");
  if (bal >= 0.5 * LAMPORTS_PER_SOL) return;
  try {
    const sig = await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest });
    console.log("Airdropped 1 SOL");
  } catch (e) {
    console.error(
      `Airdrop failed (devnet rate limits are common). Fund manually at https://faucet.solana.com:\n${payer.publicKey.toBase58()}`
    );
    process.exit(1);
  }
}

// ---------- PHASE 1: prepare (steps 3-11) ----------
async function prepare() {
  const payer = loadOrCreatePayer();
  await ensureFunded(payer);

  // 3. Generate nonce account keypair
  const nonceKp = Keypair.generate();
  console.log("Nonce account:", nonceKp.publicKey.toBase58());

  // 4 + 5. Fund (rent-exempt) and initialize the nonce account
  const rent = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  const createTx = new Transaction().add(
    SystemProgram.createNonceAccount({
      fromPubkey: payer.publicKey,
      noncePubkey: nonceKp.publicKey,
      authorizedPubkey: payer.publicKey,
      lamports: rent,
    })
  );
  const createSig = await sendAndConfirmTransaction(connection, createTx, [payer, nonceKp]);
  console.log("Nonce account created:", createSig);

  // 6. Read the durable nonce
  const nonceAccount = await connection.getNonce(nonceKp.publicKey, "confirmed");
  if (!nonceAccount) throw new Error("Nonce account not found after creation");
  const nonceValue = nonceAccount.nonce;
  console.log("Durable nonce value:", nonceValue);

  // Control: a normal blockhash, to prove later that it expired
  const control = await connection.getLatestBlockhash("confirmed");

  // 7. Create a SOL transfer (to a fresh recipient)
  const recipient = Keypair.generate().publicKey;
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports: 0.01 * LAMPORTS_PER_SOL,
  });

  // 8 + 9. nonceAdvance FIRST, then transfer; recentBlockhash = the nonce value
  const tx = new Transaction();
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: nonceKp.publicKey,
      authorizedPubkey: payer.publicKey,
    })
  );
  tx.add(transferIx);
  tx.recentBlockhash = nonceValue;
  tx.feePayer = payer.publicKey;

  // 10. Sign (payer is fee payer AND nonce authority, so one signature covers both)
  tx.sign(payer);

  // 11. Record timestamp + persist the signed tx (this is the "offline queue")
  const signedAt = Date.now();
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        signedAt,
        noncePubkey: nonceKp.publicKey.toBase58(),
        nonceValue,
        recipient: recipient.toBase58(),
        controlBlockhash: control.blockhash,
        controlLastValidBlockHeight: control.lastValidBlockHeight,
        serializedTx: tx.serialize().toString("base64"),
      },
      null,
      2
    )
  );
  console.log(`\nSigned at ${new Date(signedAt).toISOString()}`);
  console.log(`Saved to ${STATE_FILE}. Wait 5+ minutes, then run: npx tsx nonce-spike.ts broadcast`);
}

// ---------- PHASE 2: broadcast (steps 12-15) ----------
async function broadcast() {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  // 12. Enforce the wait
  const elapsed = Date.now() - state.signedAt;
  if (elapsed < MIN_WAIT_MS && !process.argv.includes("--force")) {
    const remaining = Math.ceil((MIN_WAIT_MS - elapsed) / 1000);
    console.log(`Only ${Math.floor(elapsed / 1000)}s elapsed. Wait ${remaining}s more (or pass --force).`);
    return;
  }

  // Prove a normal blockhash from signing time is now dead
  const controlValid = await connection.isBlockhashValid(state.controlBlockhash, {
    commitment: "confirmed",
  });
  console.log("Control blockhash still valid?", controlValid.value, "(expected: false)");

  // 13. Broadcast the signed transaction
  const raw = Buffer.from(state.serializedTx, "base64");
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
  console.log("Broadcast signature:", signature);

  // 14. Confirm using the nonce-based strategy (blockhash expiry doesn't apply)
  const minContextSlot = await connection.getSlot("confirmed");
  const result = await connection.confirmTransaction(
    {
      signature,
      minContextSlot,
      nonceAccountPubkey: new (await import("@solana/web3.js")).PublicKey(state.noncePubkey),
      nonceValue: state.nonceValue,
    },
    "confirmed"
  );
  if (result.value.err) throw new Error("Tx failed: " + JSON.stringify(result.value.err));

  // 15. Print the result
  const recipientBal = await connection.getBalance(
    new (await import("@solana/web3.js")).PublicKey(state.recipient)
  );
  console.log("\n=== RESULT ===");
  console.log("Signed at:        ", new Date(state.signedAt).toISOString());
  console.log("Broadcast after:  ", Math.floor((Date.now() - state.signedAt) / 1000), "seconds");
  console.log("Control blockhash valid:", controlValid.value);
  console.log("Recipient balance:", recipientBal / LAMPORTS_PER_SOL, "SOL");
  console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  console.log(
    !controlValid.value && recipientBal > 0
      ? "PASS: tx landed after a normal blockhash would have expired."
      : "Inconclusive, check the values above."
  );
}

const cmd = process.argv[2];
(cmd === "prepare" ? prepare() : cmd === "broadcast" ? broadcast() : Promise.resolve(console.log("Usage: prepare | broadcast [--force]")))
  .catch((e) => { console.error(e); process.exit(1); });
