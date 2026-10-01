import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as nacl from "tweetnacl";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../target/idl/pat.json");

// ───────────── config ─────────────
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const FUNDER_PATH = process.env.FUNDER ?? path.join(os.homedir(), ".config/solana/id.json");
const STATE_DIR = path.join(__dirname, "..", ".pat-demo");

const INTENT_DOMAIN = Buffer.from("PAT-INTENT-v1", "ascii"); // 13 bytes
const INTENT_VERSION = 1;
const CLUSTER_ID = 1; // devnet, must equal constants.rs

const CAPACITY = 100_000_000n;       // 0.1 SOL locked
const PER_PAYMENT_CAP = 50_000_000n; // 0.05 SOL
const MAX_PAYMENTS = 3;
const PAY_AMOUNT = 20_000_000n;      // 0.02 SOL
const RESERVATION_LIFETIME = 3600;   // seconds
const INTENT_LIFETIME = 900;         // seconds

const connection = new Connection(RPC, "confirmed");

// ───────────── small helpers ─────────────
const log = (s = "") => console.log(s);
const sol = (l: bigint | number) => (Number(l) / LAMPORTS_PER_SOL).toFixed(6) + " SOL";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

function loadOrCreate(name: string): Keypair {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${name}.json`);
  if (fs.existsSync(file)) return loadKeypair(file);
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function balance(pk: PublicKey): Promise<bigint> {
  return BigInt(await connection.getBalance(pk, "confirmed"));
}

/** Devnet's own clock. Avoids local-clock skew against Clock::get() in the program. */
async function chainNow(): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  const t = await connection.getBlockTime(slot);
  return t ?? Math.floor(Date.now() / 1000);
}

async function topUp(funder: Keypair, to: PublicKey, minLamports: bigint, label: string) {
  const have = await balance(to);
  if (have >= minLamports) {
    log(`  ${label} already funded (${sol(have)})`);
    return;
  }
  const need = minLamports - have;
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports: need })
  );
  await sendAndConfirmTransaction(connection, tx, [funder], { commitment: "confirmed" });
  log(`  funded ${label} with ${sol(need)}`);
}

function programFor(kp: Keypair): Program<any> {
  const provider = new AnchorProvider(connection, new Wallet(kp), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(IDL, provider);
}

// ───────────── intent wire format (matches state.rs signing_bytes) ─────────────
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const i64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

type Intent = {
  version: number; cluster: number; paymentId: Buffer;
  payer: PublicKey; merchant: PublicKey; reservation: PublicKey;
  amount: bigint; createdAt: number; expiresAt: number;
  sequence: number; committedAfter: bigint;
};

/** borsh(PaymentIntent): 166 bytes. */
function encodeBody(i: Intent): Buffer {
  return Buffer.concat([
    Buffer.from([i.version]), Buffer.from([i.cluster]), i.paymentId,
    i.payer.toBuffer(), i.merchant.toBuffer(), i.reservation.toBuffer(),
    u64(i.amount), i64(i.createdAt), i64(i.expiresAt), u32(i.sequence), u64(i.committedAfter),
  ]);
}

function decodeBody(b: Buffer): Intent {
  if (b.length !== 166) throw new Error(`BAD_PAYLOAD_LENGTH: ${b.length}`);
  return {
    version: b[0], cluster: b[1], paymentId: b.subarray(2, 34),
    payer: new PublicKey(b.subarray(34, 66)),
    merchant: new PublicKey(b.subarray(66, 98)),
    reservation: new PublicKey(b.subarray(98, 130)),
    amount: b.readBigUInt64LE(130),
    createdAt: Number(b.readBigInt64LE(138)),
    expiresAt: Number(b.readBigInt64LE(146)),
    sequence: b.readUInt32LE(154),
    committedAfter: b.readBigUInt64LE(158),
  };
}

/** Exactly what the customer signs: INTENT_DOMAIN || borsh(intent). 179 bytes. */
const signingBytes = (body: Buffer) => Buffer.concat([INTENT_DOMAIN, body]);

// ───────────── offline ledger (file-backed here; localForage in the PWA) ─────────────
type PendingIntent = { paymentId: string; amount: bigint; sequence: number; signedAt: number };
type OfflineLedger = {
  reservation: string; capacity: bigint; perPaymentCap: bigint;
  expiresAt: number; settleDeadline: number;
  committedOnChain: bigint; pending: PendingIntent[]; nextSequence: number;
};

const ledgerFile = (res: PublicKey) => path.join(STATE_DIR, `ledger-${res.toBase58()}.json`);

function saveLedger(l: OfflineLedger) {
  fs.writeFileSync(
    ledgerFile(new PublicKey(l.reservation)),
    JSON.stringify(l, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2)
  );
}

function loadLedger(res: PublicKey): OfflineLedger | null {
  const f = ledgerFile(res);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8"), (_k, v) =>
    typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v
  );
}

const pendingTotal = (l: OfflineLedger) => l.pending.reduce((s, p) => s + p.amount, 0n);
const availableOffline = (l: OfflineLedger) => l.capacity - l.committedOnChain - pendingTotal(l);

/** Customer side. No network calls in here: this is the part that must work offline. */
function signPayment(
  customer: Keypair,
  res: PublicKey,
  req: { paymentId: Buffer; merchant: PublicKey; amount: bigint },
  now: number
): { body: Buffer; signature: Buffer } {
  const l = loadLedger(res);
  if (!l) throw new Error("NO_LEDGER");                   // fail closed
  if (now >= l.expiresAt) throw new Error("RESERVATION_EXPIRED");
  if (req.amount <= 0n) throw new Error("ZERO_AMOUNT");
  if (req.amount > l.perPaymentCap) throw new Error("OVER_PER_PAYMENT_CAP");
  if (req.amount > availableOffline(l)) throw new Error("INSUFFICIENT_OFFLINE_BALANCE");

  const sequence = l.nextSequence;
  const committedAfter = l.committedOnChain + pendingTotal(l) + req.amount;

  // Write-ahead: persist the debit BEFORE a signature exists.
  l.pending.push({ paymentId: req.paymentId.toString("hex"), amount: req.amount, sequence, signedAt: now });
  l.nextSequence += 1;
  saveLedger(l);

  const body = encodeBody({
    version: INTENT_VERSION, cluster: CLUSTER_ID, paymentId: req.paymentId,
    payer: customer.publicKey, merchant: req.merchant, reservation: res,
    amount: req.amount, createdAt: now,
    expiresAt: Math.min(now + INTENT_LIFETIME, l.expiresAt), // must be <= reservation.expires_at
    sequence, committedAfter,
  });
  const signature = Buffer.from(nacl.sign.detached(signingBytes(body), customer.secretKey));
  return { body, signature };
}

/** Online step: credit back only on proof (the Payment PDA exists). */
async function reconcile(program: Program<any>, res: PublicKey) {
  const l = loadLedger(res);
  if (!l) throw new Error("NO_LEDGER");
  const state: any = await (program.account as any).reservation.fetch(res);
  const pdas = l.pending.map((p) => paymentPda(program.programId, res, Buffer.from(p.paymentId, "hex")));
  const infos = pdas.length ? await connection.getMultipleAccountsInfo(pdas, "confirmed") : [];
  l.pending = l.pending.filter((_p, i) => infos[i] === null); // keep those with no PDA yet
  l.committedOnChain = BigInt(state.committed.toString());
  saveLedger(l);
  return l;
}

const paymentPda = (programId: PublicKey, res: PublicKey, paymentId: Buffer) =>
  PublicKey.findProgramAddressSync([Buffer.from("payment"), res.toBuffer(), paymentId], programId)[0];

// ───────────── main flow ─────────────
async function main() {
  const funder = loadKeypair(FUNDER_PATH);
  const customer = loadOrCreate("customer");
  const merchant = loadOrCreate("merchant");
  const customerProgram = programFor(customer);
  const merchantProgram = programFor(merchant);
  const programId = customerProgram.programId;

  log("PAT end-to-end on devnet");
  log(`  program   ${programId.toBase58()}`);
  log(`  funder    ${funder.publicKey.toBase58()}`);
  log(`  customer  ${customer.publicKey.toBase58()}`);
  log(`  merchant  ${merchant.publicKey.toBase58()}`);

  // 0. Fund (customer needs capacity + rent_reserve + rent + fees; merchant needs to front Payment rent + fees)
  log("\n[0] Funding");
  await topUp(funder, customer.publicKey, 300_000_000n, "customer");
  await topUp(funder, merchant.publicKey, 10_000_000n, "merchant");
  const merchantBefore = await balance(merchant.publicKey);

  // 1. Customer reserves while online
  log("\n[1] Customer reserves an offline allowance (online)");
  const reservationId = Date.now(); // unique, never reused
  const expiresAt = (await chainNow()) + RESERVATION_LIFETIME;
  const reservationPda = PublicKey.findProgramAddressSync(
    [Buffer.from("reservation"), customer.publicKey.toBuffer(), new BN(reservationId).toArrayLike(Buffer, "le", 8)],
    programId
  )[0];

  const reserveSig = await (customerProgram as any).methods
    .reserve(
      new BN(reservationId),
      new BN(CAPACITY.toString()),
      new BN(PER_PAYMENT_CAP.toString()),
      new BN(expiresAt),
      MAX_PAYMENTS
    )
    .accounts({
      owner: customer.publicKey,
      reservation: reservationPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([customer])
    .rpc();
  log(`  reservation ${reservationPda.toBase58()}`);
  log(`  tx ${reserveSig}`);

  // Customer app initialises its ledger from the on-chain reservation.
  const r: any = await (customerProgram.account as any).reservation.fetch(reservationPda);
  saveLedger({
    reservation: reservationPda.toBase58(),
    capacity: BigInt(r.capacity.toString()),
    perPaymentCap: BigInt(r.perPaymentCap.toString()),
    expiresAt: Number(r.expiresAt.toString()),
    settleDeadline: Number(r.settleDeadline.toString()),
    committedOnChain: BigInt(r.committed.toString()),
    pending: [],
    nextSequence: 0,
  });
  log(`  available offline: ${sol(availableOffline(loadLedger(reservationPda)!))}`);

  // 2. OFFLINE: customer signs. No network calls from here until step 3.
  log("\n[2] Customer signs a payment OFFLINE");
  const paymentId = Buffer.from(nacl.randomBytes(32));
  const { body, signature } = signPayment(
    customer, reservationPda,
    { paymentId, merchant: merchant.publicKey, amount: PAY_AMOUNT },
    await chainNow() // in the PWA this is Date.now()/1000
  );
  const qrPayload = JSON.stringify({ b: body.toString("base64"), s: signature.toString("base64") });
  log(`  QR payload: ${qrPayload.length} chars (${body.length} + ${signature.length} raw bytes)`);
  log(`  state: SIGNED. ledger available: ${sol(availableOffline(loadLedger(reservationPda)!))}`);

  // Ledger gate demo: a second payment that exceeds the offline balance must be refused.
  try {
    signPayment(customer, reservationPda,
      { paymentId: Buffer.from(nacl.randomBytes(32)), merchant: merchant.publicKey, amount: CAPACITY },
      await chainNow());
    throw new Error("gate failed to block");
  } catch (e: any) {
    log(`  gate check: oversized payment refused -> ${e.message}`);
  }

  // 3. Merchant scans the QR, verifies locally ("Offline Accepted")
  log("\n[3] Merchant verifies the payload locally");
  const scanned = JSON.parse(qrPayload);
  const mBody = Buffer.from(scanned.b, "base64");
  const mSig = Buffer.from(scanned.s, "base64");
  const intent = decodeBody(mBody);

  const sigOk = nacl.sign.detached.verify(signingBytes(mBody), mSig, intent.payer.toBytes());
  if (!sigOk) throw new Error("REJECTED: bad signature");
  if (!intent.merchant.equals(merchant.publicKey)) throw new Error("REJECTED: not addressed to this merchant");
  if (intent.cluster !== CLUSTER_ID) throw new Error("REJECTED: wrong cluster");
  if ((await chainNow()) > intent.expiresAt) throw new Error("EXPIRED: acceptance window passed");
  log(`  state: OFFLINE_ACCEPTED  (${sol(intent.amount)} from ${intent.payer.toBase58().slice(0, 8)}…)`);

  // 4. Back online: merchant submits [ed25519 verify, settle]
  log("\n[4] Merchant settles on-chain");
  const edIx = Ed25519Program.createInstructionWithPublicKey({
    publicKey: intent.payer.toBytes(),
    message: signingBytes(mBody),
    signature: mSig,
  });
  const intentArg = {
    version: intent.version, cluster: intent.cluster,
    paymentId: Array.from(intent.paymentId),
    payer: intent.payer, merchant: intent.merchant, reservation: intent.reservation,
    amount: new BN(intent.amount.toString()),
    createdAt: new BN(intent.createdAt), expiresAt: new BN(intent.expiresAt),
    sequence: intent.sequence, committedAfter: new BN(intent.committedAfter.toString()),
  };
  const payPda = paymentPda(programId, reservationPda, intent.paymentId);

  log("  state: SETTLING");
  // Casting `merchantProgram as any` cuts off Anchor's recursive builder type evaluation (TS2589)
  const settleSig: string = await (merchantProgram as any).methods
    .settle(intentArg)
    .accounts({
      settler: merchant.publicKey,
      reservation: reservationPda,
      merchant: merchant.publicKey,
      payment: payPda,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .signers([merchant])
    .preInstructions([edIx]) // must sit immediately before `settle`
    .rpc();
  log(`  tx ${settleSig}`);

  // 5. Proof of CONFIRMED: the Payment PDA exists
  log("\n[5] Confirm");
  let payment: any = null;
  for (let i = 0; i < 5 && !payment; i++) {
    try { payment = await (merchantProgram.account as any).payment.fetch(payPda); }
    catch { await sleep(1000); }
  }
  if (!payment) throw new Error("Payment PDA not found after settle");

  const merchantAfter = await balance(merchant.publicKey);
  const l = await reconcile(customerProgram, reservationPda);
  const rs: any = await (customerProgram.account as any).reservation.fetch(reservationPda);

  log(`  state: CONFIRMED`);
  log(`  Payment PDA   ${payPda.toBase58()}`);
  log(`  amount        ${sol(BigInt(payment.amount.toString()))}`);
  log(`  settled slot  ${payment.settledSlot.toString()}`);
  log(`  merchant net  ${sol(merchantAfter - merchantBefore)} (expect ~ ${sol(PAY_AMOUNT)} minus the tx fee)`);
  log(`  reservation   committed ${sol(BigInt(rs.committed.toString()))}, payments ${rs.paymentsSettled}`);
  log(`  customer ledger after reconcile: pending ${l.pending.length}, available ${sol(availableOffline(l))}`);
  log(`  explorer: https://explorer.solana.com/address/${payPda.toBase58()}?cluster=devnet`);
  log(`  settle_deadline passes at unix ${rs.settleDeadline.toString()}; withdraw becomes possible after that.`);
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message ?? e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
