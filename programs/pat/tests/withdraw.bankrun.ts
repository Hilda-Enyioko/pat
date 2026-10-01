import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

import { BankrunProvider } from "anchor-bankrun";
import { Clock, ProgramTestContext, startAnchor } from "solana-bankrun";
import {
  ComputeBudgetProgram,
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { assert } from "chai";

const { BN } = anchor;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const idlPath = path.resolve(process.cwd(), "target/idl/pat.json");
const IDL = JSON.parse(fs.readFileSync(idlPath, "utf8"));

type LooseProgram = Omit<Program, "methods" | "account"> & {
  account: Record<string, any>;
  methods: Record<string, (...args: any[]) => any>;
};

const T0 = 1_700_000_000;
const DAY = 86_400;
const GRACE = 30 * 60;
const SOL = 1_000_000_000n;
const RESERVATION_SPACE = 109n; // pinned in state.rs tests

let context: ProgramTestContext;
let provider: BankrunProvider;
let program: LooseProgram;
let nonce = 0;

// ───────────── helpers ─────────────

async function setTime(unixTs: number) {
  const c = await context.banksClient.getClock();
  context.setClock(
    new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, BigInt(unixTs))
  );
}

/** Identical transactions are deduplicated by the bank. A unique compute-unit limit makes
 *  each attempt distinct (needed when we retry the same withdraw at a later time). */
const uniq = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 + nonce++ });

function fund(pk: PublicKey, lamports: bigint) {
  context.setAccount(pk, {
    lamports: Number(lamports),
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
  });
}

const bal = async (pk: PublicKey) => await context.banksClient.getBalance(pk);

async function expectFail(p: Promise<unknown>, name: string) {
  try {
    await p;
  } catch (e: any) {
    const text = `${e?.message ?? e} ${(e?.logs ?? []).join(" ")} ${JSON.stringify(e?.error ?? {})}`;
    assert.include(text, name, `expected failure containing "${name}", got: ${text}`);
    return;
  }
  assert.fail(`expected failure "${name}" but the transaction succeeded`);
}

const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const i64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

type Intent = {
  paymentId: Buffer; payer: PublicKey; merchant: PublicKey; reservation: PublicKey;
  amount: bigint; createdAt: number; expiresAt: number; sequence: number; committedAfter: bigint;
};

/** INTENT_DOMAIN || borsh(PaymentIntent). Same layout as the Rust signing_bytes (179 bytes). */
function intentBytes(i: Intent): Buffer {
  return Buffer.concat([
    Buffer.from("PAT-INTENT-v1", "ascii"),
    Buffer.from([1]), // version
    Buffer.from([1]), // cluster: devnet, must equal CLUSTER_ID in constants.rs
    i.paymentId,
    i.payer.toBuffer(), i.merchant.toBuffer(), i.reservation.toBuffer(),
    u64(i.amount), i64(i.createdAt), i64(i.expiresAt), u32(i.sequence), u64(i.committedAfter),
  ]);
}

function paymentPda(reservation: PublicKey, paymentId: Buffer) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), reservation.toBuffer(), paymentId],
    program.programId
  )[0];
}

type Res = { pda: PublicKey; id: number; owner: Keypair; capacity: bigint; expiresAt: number; deadline: number };
let nextResId = 1;

async function reserve(owner: Keypair, capacity = SOL, perCap = 800_000_000n, maxPayments = 5): Promise<Res> {
  const id = nextResId++;
  const expiresAt = T0 + DAY;
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from("reservation"), owner.publicKey.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];
  await program.methods
    .reserve(new BN(id), new BN(capacity.toString()), new BN(perCap.toString()), new BN(expiresAt), maxPayments)
    .accounts({ owner: owner.publicKey, reservation: pda, systemProgram: SystemProgram.programId })
    .signers([owner])
    .preInstructions([uniq()])
    .rpc();
  return { pda, id, owner, capacity, expiresAt, deadline: expiresAt + GRACE };
}

async function settle(res: Res, relayer: Keypair, merchant: PublicKey, opts: {
  amount: bigint; committedAfter: bigint; sequence: number; now: number; paymentId?: Buffer;
}) {
  const paymentId = opts.paymentId ?? Buffer.from(Keypair.generate().publicKey.toBytes());
  const intent: Intent = {
    paymentId, payer: res.owner.publicKey, merchant, reservation: res.pda,
    amount: opts.amount, createdAt: opts.now, expiresAt: opts.now + 3600,
    sequence: opts.sequence, committedAfter: opts.committedAfter,
  };
  const edIx = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: res.owner.secretKey,
    message: intentBytes(intent),
  });
  const intentArg = {
    version: 1, cluster: 1, paymentId: Array.from(paymentId),
    payer: intent.payer, merchant, reservation: res.pda,
    amount: new BN(opts.amount.toString()), createdAt: new BN(intent.createdAt),
    expiresAt: new BN(intent.expiresAt), sequence: opts.sequence,
    committedAfter: new BN(opts.committedAfter.toString()),
  };
  await program.methods
    .settle(intentArg)
    .accounts({
      settler: relayer.publicKey,
      reservation: res.pda,
      merchant,
      payment: paymentPda(res.pda, paymentId),
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .signers([relayer])
    // ed25519 instruction must sit IMMEDIATELY before settle, so it goes last here.
    .preInstructions([uniq(), edIx])
    .rpc();
  return paymentId;
}

async function withdraw(res: Res, signer: Keypair) {
  await program.methods
    .withdraw()
    .accounts({ owner: signer.publicKey, reservation: res.pda })
    .signers([signer])
    .preInstructions([uniq()])
    .rpc();
}

/** Lamport invariant (section 3.4). Settle keeps it as an equality, so assert equality. */
async function assertInvariant(res: Res) {
  const acct = await context.banksClient.getAccount(res.pda);
  assert.isNotNull(acct, "reservation account missing");
  const st: any = await program.account.reservation.fetch(res.pda);
  const rent = await context.banksClient.getRent();
  const required =
    rent.minimumBalance(RESERVATION_SPACE) +
    BigInt(st.capacity.toString()) - BigInt(st.committed.toString()) +
    BigInt(st.rentReserve.toString());
  assert.equal(BigInt(acct!.lamports), required, "lamport invariant broken");
}

// ───────────── tests ─────────────

describe("withdraw + lamport invariant (Bankrun)", () => {
  let relayer: Keypair, merchant: Keypair, owner: Keypair, attacker: Keypair;

  beforeEach(async () => {
    context = await startAnchor(".", [], []);
    provider = new BankrunProvider(context);
    program = new Program(IDL, provider) as unknown as LooseProgram;
    await setTime(T0);

    owner = Keypair.generate(); relayer = Keypair.generate();
    merchant = Keypair.generate(); attacker = Keypair.generate();
    fund(owner.publicKey, 10n * SOL);
    fund(relayer.publicKey, 1n * SOL);
    fund(attacker.publicKey, 1n * SOL);
    // The merchant account starts empty (system-owned, 0 lamports), like a real merchant wallet.
  });

  it("blocks withdraw until strictly after settle_deadline, then refunds everything", async () => {
    const res = await reserve(owner);
    const held = await bal(res.pda);

    await setTime(T0 + 100);                 // Active
    await expectFail(withdraw(res, owner), "WithdrawTooEarly");
    await setTime(res.expiresAt);            // Expiring (start)
    await expectFail(withdraw(res, owner), "WithdrawTooEarly");
    await setTime(res.deadline);             // last second a merchant may still settle
    await expectFail(withdraw(res, owner), "WithdrawTooEarly");

    const before = await bal(owner.publicKey);
    await setTime(res.deadline + 1);         // Releasable
    await withdraw(res, owner);

    // The wallet pays the tx fee (fee payer), so the owner's delta is exactly the account balance.
    assert.equal((await bal(owner.publicKey)) - before, held);
    assert.isNull(await context.banksClient.getAccount(res.pda), "reservation should be closed");
  });

  it("rejects withdraw by anyone but the owner", async () => {
    const res = await reserve(owner);
    await setTime(res.deadline + 1);
    await expectFail(withdraw(res, attacker), "NotReservationOwner");
    assert.isNotNull(await context.banksClient.getAccount(res.pda)); // still there
  });

  it("holds the lamport invariant after every settle and rejects oversubscription", async () => {
    const res = await reserve(owner);
    await assertInvariant(res);              // equality right after reserve

    const relayerBefore = await bal(relayer.publicKey);
    await setTime(T0 + 10);

    await settle(res, relayer, merchant.publicKey, { amount: 300_000_000n, committedAfter: 300_000_000n, sequence: 0, now: T0 + 10 });
    await assertInvariant(res);
    await settle(res, relayer, merchant.publicKey, { amount: 200_000_000n, committedAfter: 500_000_000n, sequence: 1, now: T0 + 10 });
    await assertInvariant(res);

    // Settler fronts the Payment rent and is reimbursed from rent_reserve: net zero.
    assert.equal(await bal(relayer.publicKey), relayerBefore);
    assert.equal(await bal(merchant.publicKey), 500_000_000n);

    // 0.8 against 0.5 remaining. committedAfter = capacity so it passes the ledger-claim check
    // and is stopped by the capacity check itself.
    await expectFail(
      settle(res, relayer, merchant.publicKey, { amount: 800_000_000n, committedAfter: SOL, sequence: 2, now: T0 + 10 }),
      "InsufficientCapacity"
    );
    await assertInvariant(res);              // a rejected settle changes nothing
    assert.equal(await bal(merchant.publicKey), 500_000_000n);
  });

  it("rejects replaying the same payment_id and leaves the invariant intact", async () => {
    const res = await reserve(owner);
    await setTime(T0 + 10);
    const pid = await settle(res, relayer, merchant.publicKey, { amount: 100_000_000n, committedAfter: 100_000_000n, sequence: 0, now: T0 + 10 });
    await expectFail(
      settle(res, relayer, merchant.publicKey, { amount: 100_000_000n, committedAfter: 200_000_000n, sequence: 1, now: T0 + 10, paymentId: pid }),
      "already in use"
    );
    await assertInvariant(res);
    assert.equal(await bal(merchant.publicKey), 100_000_000n);
  });

  it("refunds only the unspent part after partial spend; Payment records outlive the reservation", async () => {
    const res = await reserve(owner);
    await setTime(T0 + 10);
    const p1 = await settle(res, relayer, merchant.publicKey, { amount: 300_000_000n, committedAfter: 300_000_000n, sequence: 0, now: T0 + 10 });
    const p2 = await settle(res, relayer, merchant.publicKey, { amount: 200_000_000n, committedAfter: 500_000_000n, sequence: 1, now: T0 + 10 });
    await assertInvariant(res);

    const held = await bal(res.pda);          // rent + 0.5 SOL + unused rent_reserve
    const before = await bal(owner.publicKey);
    await setTime(res.deadline + 1);
    await withdraw(res, owner);

    assert.equal((await bal(owner.publicKey)) - before, held);
    assert.isTrue(held > 500_000_000n && held < SOL, "refund should be the unspent part only");
    assert.isNull(await context.banksClient.getAccount(res.pda));
    // Merchant proof survives the withdrawal.
    assert.isNotNull(await context.banksClient.getAccount(paymentPda(res.pda, p1)));
    assert.isNotNull(await context.banksClient.getAccount(paymentPda(res.pda, p2)));
    assert.equal(await bal(merchant.publicKey), 500_000_000n);
  });

  it("rejects settle after settle_deadline; the owner then recovers the full amount", async () => {
    const res = await reserve(owner);
    const held = await bal(res.pda);
    await setTime(res.deadline + 1);
    await expectFail(
      settle(res, relayer, merchant.publicKey, { amount: 100_000_000n, committedAfter: 100_000_000n, sequence: 0, now: T0 + 10 }),
      "SettleWindowClosed"
    );
    const before = await bal(owner.publicKey);
    await withdraw(res, owner);
    assert.equal((await bal(owner.publicKey)) - before, held);
  });
});
