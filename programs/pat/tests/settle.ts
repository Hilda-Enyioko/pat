import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Ed25519Program, Keypair, LAMPORTS_PER_SOL, PublicKey,
  SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { expect } from "chai";
import { randomBytes } from "crypto";
import { Pat } from "../../../target/types/pat";
import { Intent, intentSigningBytes, toProgramIntent } from "./helpers/intent";

const RESERVATION_SPACE = 109;
const PAYMENT_SPACE = 174;
const CLUSTER_LOCALNET_PROGRAM_CONST = 1; // must equal CLUSTER_ID in constants.rs
const SOL = (n: number) => new BN(Math.round(n * LAMPORTS_PER_SOL));

describe("settle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Pat as Program<Pat>;
  const conn = provider.connection;

  const nowSecs = () => Math.floor(Date.now() / 1000);
  const DAY = 86_400;

  // ---------- helpers ----------
  async function fund(kp: Keypair, sol: number) {
    const sig = await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...bh });
  }

  const reservationPda = (owner: PublicKey, id: BN) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("reservation"), owner.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const paymentPda = (reservation: PublicKey, paymentId: Buffer) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("payment"), reservation.toBuffer(), paymentId],
      program.programId
    )[0];

  async function openReservation(capacitySol: number, perCapSol: number, maxPayments = 10) {
    const payer = Keypair.generate();
    await fund(payer, capacitySol + 2);
    const id = new BN(randomBytes(8));
    const reservation = reservationPda(payer.publicKey, id);
    await program.methods
      .reserve(id, SOL(capacitySol), SOL(perCapSol), new BN(nowSecs() + DAY), maxPayments)
      .accountsPartial({
        owner: payer.publicKey,
        reservation,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();
    const state = await program.account.reservation.fetch(reservation);
    return { payer, reservation, state };
  }

  function makeIntent(
    payer: Keypair, merchant: PublicKey, reservation: PublicKey,
    createdAt: BN, amount: BN, committedAfter: BN, sequence = 0, overrides: Partial<Intent> = {}
  ): Intent {
    return {
      version: 1,
      cluster: CLUSTER_LOCALNET_PROGRAM_CONST,
      paymentId: randomBytes(32),
      payer: payer.publicKey,
      merchant,
      reservation,
      amount,
      createdAt,
      expiresAt: createdAt.add(new BN(3600)),
      sequence,
      committedAfter,
      ...overrides,
    };
  }

  const sign = (signer: Keypair, i: Intent) =>
    nacl.sign.detached(intentSigningBytes(i), signer.secretKey);

  function edIx(signerPk: PublicKey, signedIntent: Intent, signature: Uint8Array) {
    return Ed25519Program.createInstructionWithPublicKey({
      publicKey: signerPk.toBytes(),
      message: intentSigningBytes(signedIntent),
      signature,
    });
  }

  // Submit settle. `programIntent` is what the program receives; `pre` are the instructions before it.
  function settle(
    settler: Keypair,
    programIntent: Intent,
    pre: TransactionInstruction[],
    merchantAccount: PublicKey = programIntent.merchant
  ) {
    return program.methods
      .settle(toProgramIntent(programIntent))
      .accountsPartial({
        settler: settler.publicKey,
        reservation: programIntent.reservation,
        merchant: merchantAccount,
        payment: paymentPda(programIntent.reservation, programIntent.paymentId),
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([settler])
      .rpc();
  }

  // Honest path: payer signs the intent; precompile verifies that same intent.
  const settleHonest = (settler: Keypair, payer: Keypair, i: Intent) =>
    settle(settler, i, [edIx(payer.publicKey, i, sign(payer, i))]);

  const logsOf = (e: any) =>
    [...(e?.logs ?? []), ...(e?.transactionLogs ?? []), String(e)].join("\n");
  const codeOf = (e: any) => e?.error?.errorCode?.code;

  async function expectCode(p: Promise<unknown>, code: string) {
    let threw = false;
    try { await p; } catch (e: any) {
      threw = true;
      expect(codeOf(e) ?? logsOf(e), `unexpected error: ${logsOf(e)}`).to.equal(code);
    }
    expect(threw, `expected ${code} but the call succeeded`).to.equal(true);
  }
  async function expectFails(p: Promise<unknown>, text?: string) {
    let threw = false;
    try { await p; } catch (e: any) {
      threw = true;
      if (text) expect(logsOf(e)).to.include(text);
    }
    expect(threw, "expected the transaction to fail").to.equal(true);
  }

  const merchantKp = Keypair.generate();
  const relayerKp = Keypair.generate();
  const attackerKp = Keypair.generate();

  before(async () => {
    await fund(merchantKp, 2); // merchant fronts Payment rent when settling
    await fund(relayerKp, 2);
    await fund(attackerKp, 2);
  });

  // ---------- happy path ----------
  it("settles: pays the merchant, records the Payment, keeps the lamport invariant", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const amount = SOL(0.25);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, amount, amount);

    const merchBefore = await conn.getBalance(merchantKp.publicKey);
    const paymentRent = await conn.getMinimumBalanceForRentExemption(PAYMENT_SPACE);
    const resRent = await conn.getMinimumBalanceForRentExemption(RESERVATION_SPACE);

    await settleHonest(merchantKp, payer, i); // merchant is both settler and payee

    // Merchant net = +amount (rent fronted then reimbursed; fee paid by provider wallet)
    expect((await conn.getBalance(merchantKp.publicKey)) - merchBefore).to.equal(amount.toNumber());

    const r = await program.account.reservation.fetch(reservation);
    expect(r.committed.toString()).to.equal(amount.toString());
    expect(r.paymentsSettled).to.equal(1);
    expect(r.rentReserve.toNumber()).to.equal(state.rentReserve.toNumber() - paymentRent);

    // Invariant with equality: min + (capacity - committed) + rent_reserve
    const expected = resRent + (r.capacity.toNumber() - r.committed.toNumber()) + r.rentReserve.toNumber();
    expect(await conn.getBalance(reservation)).to.equal(expected);

    const p = await program.account.payment.fetch(paymentPda(reservation, i.paymentId));
    expect(p.amount.toString()).to.equal(amount.toString());
    expect(p.merchant.toBase58()).to.equal(merchantKp.publicKey.toBase58());
    expect(p.payer.toBase58()).to.equal(payer.publicKey.toBase58());
    expect(p.reservation.toBase58()).to.equal(reservation.toBase58());
    expect(p.sequence).to.equal(0);
    expect(p.settledAt.toNumber()).to.be.greaterThan(0);
  });

  it("a relayer can settle: merchant is paid, relayer is made whole", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const amount = SOL(0.1);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, amount, amount);

    const merchBefore = await conn.getBalance(merchantKp.publicKey);
    const relayerBefore = await conn.getBalance(relayerKp.publicKey);
    await settleHonest(relayerKp, payer, i);

    expect((await conn.getBalance(merchantKp.publicKey)) - merchBefore).to.equal(amount.toNumber());
    expect(await conn.getBalance(relayerKp.publicKey)).to.equal(relayerBefore); // rent reimbursed
  });

  // ---------- double-settle guard ----------
  it("a second settle of the same payment_id fails and changes nothing", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const amount = SOL(0.2);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, amount, amount);
    const sig = sign(payer, i);

    await settle(merchantKp, i, [edIx(payer.publicKey, i, sig)]);
    const afterFirst = await program.account.reservation.fetch(reservation);
    const merchAfterFirst = await conn.getBalance(merchantKp.publicKey);

    // Replay: identical intent and signature, by the merchant and by a relayer.
    await expectFails(settle(merchantKp, i, [edIx(payer.publicKey, i, sig)]), "already in use");
    await expectFails(settle(relayerKp, i, [edIx(payer.publicKey, i, sig)]), "already in use");

    const afterReplay = await program.account.reservation.fetch(reservation);
    expect(afterReplay.committed.toString()).to.equal(afterFirst.committed.toString());
    expect(afterReplay.paymentsSettled).to.equal(1);
    expect(await conn.getBalance(merchantKp.publicKey)).to.equal(merchAfterFirst);
  });

  // ---------- tampering and signer checks ----------
  it("rejects a tampered amount (signature was over a different amount)", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const signed = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1));
    const sig = sign(payer, signed);
    // Attacker bumps the amount in the settle argument but reuses the real precompile data.
    const tampered = { ...signed, amount: SOL(0.9), committedAfter: SOL(0.9) };

    await expectCode(settle(merchantKp, tampered, [edIx(payer.publicKey, signed, sig)]), "InvalidSignature");
    expect((await program.account.reservation.fetch(reservation)).committed.toNumber()).to.equal(0);
  });

  it("rejects a tampered merchant (cannot redirect funds)", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const signed = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1));
    const sig = sign(payer, signed);
    const tampered = { ...signed, merchant: attackerKp.publicKey };

    await expectCode(settle(attackerKp, tampered, [edIx(payer.publicKey, signed, sig)]), "InvalidSignature");
  });

  it("rejects an intent signed by the wrong key claiming to be the payer", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1));
    // Attacker signs the victim's intent; the precompile pubkey is the attacker's.
    const forged = sign(attackerKp, i);
    await expectCode(settle(merchantKp, i, [edIx(attackerKp.publicKey, i, forged)]), "InvalidSignature");
  });

  it("rejects a precompile claiming the payer's key with a bad signature (precompile itself fails)", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1));
    const badSig = sign(attackerKp, i); // not the payer's signature
    await expectFails(settle(merchantKp, i, [edIx(payer.publicKey, i, badSig)]));
    expect((await program.account.reservation.fetch(reservation)).committed.toNumber()).to.equal(0);
  });

  it("rejects an attacker who owns their own key but targets someone else's reservation", async () => {
    const { reservation, state } = await openReservation(1, 1, 10);
    // Attacker names themselves as payer on the victim's reservation, with a valid signature.
    const i = makeIntent(attackerKp, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1));
    await expectCode(
      settle(merchantKp, i, [edIx(attackerKp.publicKey, i, sign(attackerKp, i))]),
      "PayerMismatch"
    );
  });

  it("rejects when there is no ed25519 instruction", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1));
    await expectCode(settle(merchantKp, i, []), "InvalidSignature");
  });

  it("rejects when the ed25519 instruction is not immediately before settle", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1));
    const filler = SystemProgram.transfer({
      fromPubkey: merchantKp.publicKey, toPubkey: relayerKp.publicKey, lamports: 1,
    });
    await expectCode(
      settle(merchantKp, i, [edIx(payer.publicKey, i, sign(payer, i)), filler]),
      "InvalidSignature"
    );
  });

  it("rejects when the merchant account passed does not match the intent", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1));
    await expectCode(
      settle(attackerKp, i, [edIx(payer.publicKey, i, sign(payer, i))], attackerKp.publicKey),
      "MerchantMismatch"
    );
  });

  // ---------- intent validation ----------
  it("rejects the wrong cluster", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1), 0, { cluster: 2 });
    await expectCode(settleHonest(merchantKp, payer, i), "WrongCluster");
  });

  it("rejects an amount above the per-payment cap", async () => {
    const { payer, reservation, state } = await openReservation(1, 0.3, 10);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.4), SOL(0.4));
    await expectCode(settleHonest(merchantKp, payer, i), "ExceedsPerPaymentCap");
  });

  it("rejects an intent that predates its reservation", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const i = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt.sub(new BN(10)), SOL(0.1), SOL(0.1));
    await expectCode(settleHonest(merchantKp, payer, i), "InvalidIntentWindow");
  });

  it("stops after max_payments: rent_reserve runs out", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 1); // rent for one payment only
    const a = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.1), 0);
    const b = makeIntent(payer, merchantKp.publicKey, reservation, state.createdAt, SOL(0.1), SOL(0.2), 1);
    await settleHonest(merchantKp, payer, a);
    await expectCode(settleHonest(merchantKp, payer, b), "RentReserveExhausted");
  });

  // ---------- oversubscription: the Day 2 headline ----------
  it("0.7 then 0.7 against a 1 SOL reservation: the second is rejected", async () => {
    const { payer, reservation, state } = await openReservation(1, 1, 10);
    const merchantA = merchantKp;
    const merchantB = Keypair.generate();
    await fund(merchantB, 1);

    // A modified wallet equivocates: both intents claim committed_after = 0.7,
    // as if each were the first payment.
    const toA = makeIntent(payer, merchantA.publicKey, reservation, state.createdAt, SOL(0.7), SOL(0.7), 0);
    const toB = makeIntent(payer, merchantB.publicKey, reservation, state.createdAt, SOL(0.7), SOL(0.7), 0);

    await settleHonest(merchantA, payer, toA);

    const bBefore = await conn.getBalance(merchantB.publicKey);
    await expectCode(settleHonest(merchantB, payer, toB), "InsufficientCapacity");

    // State unchanged by the failed settle; B received nothing and has no Payment record.
    const r = await program.account.reservation.fetch(reservation);
    expect(r.committed.toString()).to.equal(SOL(0.7).toString());
    expect(r.paymentsSettled).to.equal(1);
    expect(await conn.getBalance(merchantB.publicKey)).to.equal(bBefore);
    expect(await conn.getAccountInfo(paymentPda(reservation, toB.paymentId))).to.equal(null);

    // The remaining 0.3 can still be spent, which exhausts capacity exactly.
    const rest = makeIntent(payer, merchantB.publicKey, reservation, state.createdAt, SOL(0.3), SOL(1.0), 1);
    await settleHonest(merchantB, payer, rest);
    const done = await program.account.reservation.fetch(reservation);
    expect(done.committed.toString()).to.equal(done.capacity.toString());
    expect(done.paymentsSettled).to.equal(2);
  });
});
