import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { randomBytes } from "crypto";

const DECIMALS = 6;
const unit = 10n ** BigInt(DECIMALS);
const U = (n: number) => new BN((BigInt(n) * unit).toString());
const DAY = 86_400;

describe("SPL delegated rail", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = anchor.workspace.Pat;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const owner = Keypair.generate();
  const keeper = Keypair.generate();
  const attacker = Keypair.generate();

  let mint: PublicKey;
  let otherMint: PublicKey;
  let ownerAta: PublicKey;
  let merchantCode: number;
  let payout: PublicKey;

  const nowSecs = () => Math.floor(Date.now() / 1000);
  const errText = (e: any) =>
    [e?.message, ...(e?.logs ?? []), ...(e?.transactionLogs ?? []), JSON.stringify(e?.error ?? {})].join("\n");

  async function expectFails(p: Promise<unknown>, pattern: RegExp) {
    let threw = false;
    try { await p; } catch (e: any) {
      threw = true;
      expect(errText(e), "unexpected error").to.match(pattern);
    }
    expect(threw, `expected failure matching ${pattern}`).to.equal(true);
  }

  // Transfers from the provider wallet instead of airdropping, so this also works on devnet.
  async function fund(to: PublicKey, sol: number) {
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: admin.publicKey, toPubkey: to, lamports: sol * LAMPORTS_PER_SOL }));
    await provider.sendAndConfirm(tx, [admin]);
  }

  const reservationPda = (id: BN) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("reservation"), owner.publicKey.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      program.programId)[0];
  const merchantPda = (code: number) => {
    const b = Buffer.alloc(4); b.writeUInt32LE(code);
    return PublicKey.findProgramAddressSync([Buffer.from("merchant"), b], program.programId)[0];
  };
  const paymentPda = (reservation: PublicKey, id: Buffer) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("payment"), reservation.toBuffer(), id], program.programId)[0];

  async function openReservation(opts: {
    capacity?: number; cap?: number; maxPayments?: number; delegate?: PublicKey; mint?: PublicKey;
  } = {}) {
    const { capacity = 100, cap = 25, maxPayments = 10, delegate = keeper.publicKey } = opts;
    const m = opts.mint ?? mint;
    const id = new BN(randomBytes(8));
    const reservation = reservationPda(id);
    const vault = getAssociatedTokenAddressSync(m, reservation, true);
    await program.methods
      .reserveDelegated(id, U(capacity), U(cap), new BN(nowSecs() + DAY), maxPayments, delegate)
      .accountsPartial({
        owner: owner.publicKey, reservation, mint: m, ownerTokenAccount: ownerAta, vault,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
    return { id, reservation, vault };
  }

  async function settle(p: {
    reservation: PublicKey; amount: number; signer?: Keypair; code?: number;
    paymentId?: Buffer; merchantTokenAccount?: PublicKey; mint?: PublicKey; payoutKey?: PublicKey;
  }) {
    const signer = p.signer ?? keeper;
    const m = p.mint ?? mint;
    const code = p.code ?? merchantCode;
    const paymentId = p.paymentId ?? randomBytes(32);
    const vault = getAssociatedTokenAddressSync(m, p.reservation, true);
    const merchantAta = p.merchantTokenAccount
      ?? getAssociatedTokenAddressSync(m, p.payoutKey ?? payout, true);
    const ix = await program.methods
      .settleDelegated(Array.from(paymentId), U(p.amount))
      .accountsPartial({
        delegate: signer.publicKey, reservation: p.reservation,
        merchantEntry: merchantPda(code), mint: m, vault, merchantTokenAccount: merchantAta,
        payment: paymentPda(p.reservation, paymentId),
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        signer.publicKey, merchantAta, p.payoutKey ?? payout, m),
      ix);
    await sendAndConfirmTransaction(conn, tx, [signer], { commitment: "confirmed" });
    return paymentId;
  }

  const tokenBal = async (ata: PublicKey) => (await getAccount(conn, ata)).amount;
  const merchantBal = async () =>
    tokenBal(getAssociatedTokenAddressSync(mint, payout, true)).catch(() => 0n);

  before(async () => {
    await Promise.all([fund(owner.publicKey, 2), fund(keeper.publicKey, 2), fund(attacker.publicKey, 1)]);

    mint = await createMint(conn, admin, admin.publicKey, null, DECIMALS);
    otherMint = await createMint(conn, admin, admin.publicKey, null, DECIMALS);
    ownerAta = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, owner.publicKey)).address;
    await mintTo(conn, admin, mint, ownerAta, admin, 100_000n * unit);

    const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
    if (!(await conn.getAccountInfo(configPda))) {
      await program.methods.initConfig()
        .accountsPartial({ admin: admin.publicKey, config: configPda, systemProgram: SystemProgram.programId })
        .rpc();
    }
    // Random code per run so reruns against devnet don't collide.
    merchantCode = 1 + Math.floor(Math.random() * 2_000_000_000);
    payout = Keypair.generate().publicKey;
    await program.methods.registerMerchant(merchantCode, payout)
      .accountsPartial({
        admin: admin.publicKey, config: configPda,
        merchantEntry: merchantPda(merchantCode), systemProgram: SystemProgram.programId,
      }).rpc();
  });

  it("reserve_delegated moves tokens into the vault and records delegate + mint", async () => {
    const before = await tokenBal(ownerAta);
    const { reservation, vault } = await openReservation({ capacity: 100, cap: 25 });

    expect(await tokenBal(vault)).to.equal(100n * unit);
    expect(before - (await tokenBal(ownerAta))).to.equal(100n * unit);

    const r = await program.account.reservation.fetch(reservation);
    expect(r.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(r.delegate.toBase58()).to.equal(keeper.publicKey.toBase58());
    expect(r.mint.toBase58()).to.equal(mint.toBase58());
    expect(r.capacity.toString()).to.equal(U(100).toString());
    expect(r.committed.toNumber()).to.equal(0);
  });

  it("rejects the owner as delegate", async () => {
    await expectFails(openReservation({ delegate: owner.publicKey }), /InvalidDelegate/);
  });

  it("settle_delegated pays the merchant's token account and records the payment", async () => {
    const { reservation, vault } = await openReservation();
    const before = await merchantBal();
    const pid = await settle({ reservation, amount: 10 });

    expect((await merchantBal()) - before).to.equal(10n * unit);
    expect(await tokenBal(vault)).to.equal(90n * unit);

    const r = await program.account.reservation.fetch(reservation);
    expect(r.committed.toString()).to.equal(U(10).toString());
    expect(r.paymentsSettled).to.equal(1);

    const p = await program.account.payment.fetch(paymentPda(reservation, pid));
    expect(p.amount.toString()).to.equal(U(10).toString());
    expect(p.payer.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(p.reservation.toBase58()).to.equal(reservation.toBase58());
  });

  it("vault balance always equals capacity minus committed", async () => {
    const { reservation, vault } = await openReservation();
    await settle({ reservation, amount: 7 });
    await settle({ reservation, amount: 13 });
    const r = await program.account.reservation.fetch(reservation);
    const expected = BigInt(r.capacity.toString()) - BigInt(r.committed.toString());
    expect(await tokenBal(vault)).to.equal(expected);
  });

  it("rejects a signer that is not the delegate (including the owner)", async () => {
    const { reservation, vault } = await openReservation();
    await expectFails(settle({ reservation, amount: 5, signer: attacker }), /NotDelegate/);
    await expectFails(settle({ reservation, amount: 5, signer: owner }), /NotDelegate/);
    expect(await tokenBal(vault)).to.equal(100n * unit);
  });

  it("enforces the per-payment cap (exactly at the cap is allowed)", async () => {
    const { reservation } = await openReservation({ cap: 20 });
    await expectFails(settle({ reservation, amount: 21 }), /ExceedsPerPaymentCap/);
    await settle({ reservation, amount: 20 });
  });

  it("rejects a zero amount", async () => {
    const { reservation } = await openReservation();
    await expectFails(settle({ reservation, amount: 0 }), /ZeroAmount/);
  });

  it("rejects over-capacity and leaves balances unchanged", async () => {
    const { reservation, vault } = await openReservation({ capacity: 50, cap: 40 });
    await settle({ reservation, amount: 35 });
    const before = await merchantBal();
    await expectFails(settle({ reservation, amount: 35 }), /InsufficientCapacity/);
    expect(await merchantBal()).to.equal(before);
    expect(await tokenBal(vault)).to.equal(15n * unit);
    await settle({ reservation, amount: 15 }); // exactly exhausts
    expect(await tokenBal(vault)).to.equal(0n);
  });

  it("rejects an unregistered merchant code", async () => {
    const { reservation } = await openReservation();
    await expectFails(settle({ reservation, amount: 5, code: 1999999999 }), /AccountNotInitialized/);
  });

  it("rejects a token account that is not the registered merchant's", async () => {
    const { reservation } = await openReservation();
    const impostor = Keypair.generate().publicKey;
    await expectFails(
      settle({ reservation, amount: 5, payoutKey: impostor }),
      /MerchantMismatch|ConstraintTokenOwner|ConstraintAssociated|ConstraintTokenMint/
    );
  });

  it("rejects a mint that does not match the reservation", async () => {
    const { reservation } = await openReservation();
    await expectFails(
      settle({ reservation, amount: 5, mint: otherMint }),
      /Constraint|InvalidMint|MintMismatch|AccountNotInitialized/
    );
  });

  it("rejects a double settle of the same payment_id", async () => {
    const { reservation } = await openReservation();
    const pid = await settle({ reservation, amount: 5 });
    const before = await merchantBal();
    await expectFails(settle({ reservation, amount: 5, paymentId: pid }), /already in use/);
    expect(await merchantBal()).to.equal(before);
  });

  it("stops after max_payments", async () => {
    const { reservation } = await openReservation({ maxPayments: 1 });
    await settle({ reservation, amount: 1 });
    await expectFails(settle({ reservation, amount: 1 }), /RentReserveExhausted/);
  });
});
