import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { randomBytes } from "crypto";
import { Pat } from "../../../target/types/pat";

const RESERVATION_SPACE = 109;
const PAYMENT_SPACE = 174;
const SETTLE_GRACE_SECS = 30 * 60;
const TX_FEE = 5_000;

describe("reserve", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Pat as Program<Pat>;
  const owner = provider.wallet.publicKey;
  const conn = provider.connection;

  const nowSecs = () => Math.floor(Date.now() / 1000);
  // Random 64-bit id: never reuse reservation ids per owner.
  const newId = () => new BN(randomBytes(8));

  const reservationPda = (id: BN) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("reservation"), owner.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const codeOf = (e: any) => e?.error?.errorCode?.code;
  async function expectCode(p: Promise<unknown>, code: string) {
    let threw = false;
    try {
      await p;
    } catch (e: any) {
      threw = true;
      expect(codeOf(e), `unexpected error: ${e}`).to.equal(code);
    }
    expect(threw, `expected ${code} but the call succeeded`).to.equal(true);
  }

  const call = (
    id: BN, capacity: BN, cap: BN, expiresAt: BN, maxPayments: number
  ) =>
    program.methods
      .reserve(id, capacity, cap, expiresAt, maxPayments)
      .accountsPartial({
        owner,
        reservation: reservationPda(id),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  const DAY = 24 * 60 * 60;

  it("locks capacity and rent reserve, and records state", async () => {
    const id = newId();
    const capacity = new BN(1 * LAMPORTS_PER_SOL);
    const cap = new BN(0.25 * LAMPORTS_PER_SOL);
    const expiresAt = new BN(nowSecs() + DAY);
    const maxPayments = 10;

    const paymentRent = await conn.getMinimumBalanceForRentExemption(PAYMENT_SPACE);
    const reservationRent = await conn.getMinimumBalanceForRentExemption(RESERVATION_SPACE);
    const rentReserve = paymentRent * maxPayments;

    const ownerBefore = await conn.getBalance(owner);
    await call(id, capacity, cap, expiresAt, maxPayments);
    const ownerAfter = await conn.getBalance(owner);

    const pda = reservationPda(id);
    const r = await program.account.reservation.fetch(pda);

    // State
    expect(r.owner.toBase58()).to.equal(owner.toBase58());
    expect(r.reservationId.toString()).to.equal(id.toString());
    expect(r.capacity.toString()).to.equal(capacity.toString());
    expect(r.committed.toNumber()).to.equal(0);
    expect(r.rentReserve.toNumber()).to.equal(rentReserve);
    expect(r.perPaymentCap.toString()).to.equal(cap.toString());
    expect(r.paymentsSettled).to.equal(0);
    expect(r.expiresAt.toString()).to.equal(expiresAt.toString());
    expect(r.settleDeadline.toNumber()).to.equal(expiresAt.toNumber() + SETTLE_GRACE_SECS);
    expect(r.createdAt.toNumber()).to.be.greaterThan(0);

    // Lamport invariant, with equality at creation
    const pdaLamports = await conn.getBalance(pda);
    expect(pdaLamports).to.equal(reservationRent + capacity.toNumber() + rentReserve);

    // Owner paid exactly deposit + account rent + fee
    const paid = ownerBefore - ownerAfter;
    expect(paid).to.equal(pdaLamports + TX_FEE);
  });

  it("rejects zero capacity", async () => {
    const id = newId();
    await expectCode(
      call(id, new BN(0), new BN(0), new BN(nowSecs() + DAY), 5),
      "InvalidCapacity"
    );
  });

  it("rejects per_payment_cap of zero", async () => {
    await expectCode(
      call(newId(), new BN(1000), new BN(0), new BN(nowSecs() + DAY), 5),
      "InvalidPerPaymentCap"
    );
  });

  it("rejects per_payment_cap above capacity", async () => {
    await expectCode(
      call(newId(), new BN(1000), new BN(1001), new BN(nowSecs() + DAY), 5),
      "InvalidPerPaymentCap"
    );
  });

  it("rejects an expiry in the past", async () => {
    await expectCode(
      call(newId(), new BN(1000), new BN(100), new BN(nowSecs() - 3600), 5),
      "InvalidReservationWindow"
    );
  });

  it("rejects max_payments of zero and above the limit", async () => {
    await expectCode(
      call(newId(), new BN(1000), new BN(100), new BN(nowSecs() + DAY), 0),
      "InvalidMaxPayments"
    );
    await expectCode(
      call(newId(), new BN(1000), new BN(100), new BN(nowSecs() + DAY), 1001),
      "InvalidMaxPayments"
    );
  });

  it("cannot reuse a reservation_id for the same owner", async () => {
    const id = newId();
    const args: [BN, BN, BN, number] = [new BN(1000), new BN(100), new BN(nowSecs() + DAY), 2];
    await call(id, ...args);
    let threw = false;
    try {
      await call(id, ...args);
    } catch {
      threw = true; // system program "account already in use"
    }
    expect(threw).to.equal(true);
  });

  it("allows several independent reservations for one owner", async () => {
    const a = newId(), b = newId();
    await call(a, new BN(1000), new BN(100), new BN(nowSecs() + DAY), 2);
    await call(b, new BN(2000), new BN(200), new BN(nowSecs() + DAY), 3);
    const ra = await program.account.reservation.fetch(reservationPda(a));
    const rb = await program.account.reservation.fetch(reservationPda(b));
    expect(ra.capacity.toNumber()).to.equal(1000);
    expect(rb.capacity.toNumber()).to.equal(2000);
  });
});
