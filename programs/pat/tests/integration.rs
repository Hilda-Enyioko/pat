use anchor_lang::{
    prelude::Pubkey,
    solana_program::clock::Clock,
    AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

use solana_sdk_ids::{ed25519_program, sysvar::instructions};

use pat::constants::*;
use pat::events::{PaymentSettled, ReservationCreated, ReservationWithdrawn};
use pat::state::{Payment, PaymentIntent, Reservation};

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
const PROGRAM_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/pat.so");
const BASE_TS: i64 = 1_700_000_000;
const CAPACITY: u64 = 1_000_000_000;
const PER_PAYMENT_CAP: u64 = 800_000_000;
const MAX_PAYMENTS: u32 = 10;
const RESERVATION_ID: u64 = 42;

type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

/// Conversion between LiteSVM Address and Anchor Pubkey
#[inline]
fn pk(addr: &Address) -> Pubkey {
    Pubkey::new_from_array(addr.to_bytes())
}

#[inline]
fn addr(pk: &Pubkey) -> Address {
    Address::new_from_array(pk.to_bytes())
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> TxResult {
    svm.expire_blockhash();
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new(
        &signers[..],
        Message::new(ixs, Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx)
}

fn expect_err(res: TxResult, code: &str) {
    let failed = res.expect_err("transaction should have failed");
    let logs = failed.meta.logs.join("\n");
    assert!(
        logs.contains(&format!("Error Code: {code}")),
        "expected {code}, got {:?}\n{logs}",
        failed.err
    );
}

fn expect_log(res: TxResult, needle: &str) {
    let failed = res.expect_err("transaction should have failed");
    let logs = failed.meta.logs.join("\n");
    assert!(
        logs.contains(needle),
        "expected log containing {needle:?}, got {:?}\n{logs}",
        failed.err
    );
}

fn events<T: AnchorDeserialize + Discriminator>(logs: &[String]) -> Vec<T> {
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .filter_map(|b64| STANDARD.decode(b64).ok())
        .filter(|raw| raw.starts_with(T::DISCRIMINATOR))
        .filter_map(|raw| T::deserialize(&mut &raw[8..]).ok())
        .collect()
}

fn ed25519_ix(pubkey: &Pubkey, signature: &[u8], message: &[u8]) -> Instruction {
    let mut data = Vec::with_capacity(112 + message.len());
    data.push(1u8);
    data.push(0u8);
    data.extend_from_slice(&16u16.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(&80u16.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(&112u16.to_le_bytes());
    data.extend_from_slice(&(message.len() as u16).to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(signature);
    data.extend_from_slice(pubkey.as_ref());
    data.extend_from_slice(message);
    Instruction {
        program_id: ed25519_program::ID,
        accounts: vec![],
        data,
    }
}

fn ed_ix_signed_by(signer: &Keypair, intent: &PaymentIntent) -> Instruction {
    let msg = intent.signing_bytes();
    let sig = signer.sign_message(&msg);
    let pubkey = pk(&signer.pubkey());
    ed25519_ix(&pubkey, sig.as_ref(), &msg)
}

fn payment_pda(reservation: &Pubkey, payment_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(
        &[PAYMENT_SEED, reservation.as_ref(), payment_id.as_ref()],
        &pat::ID,
    )
    .0
}

fn settle_ix(settler: &Pubkey, merchant_account: &Pubkey, intent: &PaymentIntent) -> Instruction {
    Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::Settle {
            settler: *settler,
            reservation: intent.reservation,
            merchant: *merchant_account,
            payment: payment_pda(&intent.reservation, &intent.payment_id),
            instructions_sysvar: instructions::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pat::instruction::Settle {
            intent: intent.clone(),
        }
        .data(),
    }
}

fn withdraw_ix(owner: &Pubkey, reservation: &Pubkey) -> Instruction {
    Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::Withdraw {
            owner: *owner,
            reservation: *reservation,
        }
        .to_account_metas(None),
        data: pat::instruction::Withdraw {}.data(),
    }
}

struct Fixture {
    svm: LiteSVM,
    owner: Keypair,
    merchant: Keypair,
    relayer: Keypair,
    reservation: Pubkey,
    created_at: i64,
    expires_at: i64,
    settle_deadline: i64,
    payment_rent: u64,
    reservation_rent: u64,
    reserve_logs: Vec<String>,
}

impl Fixture {
    fn default() -> Self {
        Self::new(CAPACITY, PER_PAYMENT_CAP, MAX_PAYMENTS)
    }

    fn new(capacity: u64, per_payment_cap: u64, max_payments: u32) -> Self {
        let mut svm = LiteSVM::new().with_precompiles();
        svm.add_program_from_file(pat::ID, PROGRAM_SO)
            .expect("program binary missing; run `anchor build` first");

        let owner = Keypair::new();
        let merchant = Keypair::new();
        let relayer = Keypair::new();
        for k in [&owner, &merchant, &relayer] {
            svm.airdrop(&k.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        }

        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = BASE_TS;
        svm.set_sysvar(&clock);

        let expires_at = BASE_TS + 3_600;
        let reservation = Pubkey::find_program_address(
            &[
                RESERVATION_SEED,
                owner.pubkey().as_ref(),
                &RESERVATION_ID.to_le_bytes(),
            ],
            &pat::ID,
        )
        .0;

        let ix = Instruction {
            program_id: pat::ID,
            accounts: pat::accounts::Reserve {
                owner: pk(&owner.pubkey()),
                reservation,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: pat::instruction::Reserve {
                reservation_id: RESERVATION_ID,
                capacity,
                per_payment_cap,
                expires_at,
                max_payments,
            }
            .data(),
        };
        let meta = send(&mut svm, &[ix], &relayer, &[&owner]).expect("reserve should succeed");

        let payment_rent = svm.minimum_balance_for_rent_exemption(Payment::SPACE);
        let reservation_rent = svm.minimum_balance_for_rent_exemption(Reservation::SPACE);

        Self {
            svm,
            owner,
            merchant,
            relayer,
            reservation,
            created_at: BASE_TS,
            expires_at,
            settle_deadline: expires_at + SETTLE_GRACE_SECS,
            payment_rent,
            reservation_rent,
            reserve_logs: meta.logs,
        }
    }

    fn warp_to(&mut self, ts: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = ts;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_balance(&addr(key)).unwrap_or(0)
    }

    fn reservation_state(&self) -> Option<Reservation> {
        let acct = self.svm.get_account(&addr(&self.reservation))?;
        if acct.lamports == 0 {
            return None;
        }
        Reservation::try_deserialize(&mut &acct.data[..]).ok()
    }

    fn payment_state(&self, intent: &PaymentIntent) -> Option<Payment> {
        let pda = payment_pda(&intent.reservation, &intent.payment_id);
        let acct = self.svm.get_account(&addr(&pda))?;
        if acct.lamports == 0 {
            return None;
        }
        Payment::try_deserialize(&mut &acct.data[..]).ok()
    }

    fn intent(&self, id: u8, amount: u64, sequence: u32, committed_after: u64) -> PaymentIntent {
        PaymentIntent {
            version: INTENT_VERSION,
            cluster: CLUSTER_ID,
            payment_id: [id; 32],
            payer: pk(&self.owner.pubkey()),
            merchant: pk(&self.merchant.pubkey()),
            reservation: self.reservation,
            amount,
            created_at: self.created_at + 10,
            expires_at: self.expires_at,
            sequence,
            committed_after,
        }
    }

    fn settle_raw(
        &mut self,
        ed: Instruction,
        intent: &PaymentIntent,
        merchant_account: Pubkey,
    ) -> TxResult {
        let settler = pk(&self.relayer.pubkey());
        let ix = settle_ix(&settler, &merchant_account, intent);
        send(&mut self.svm, &[ed, ix], &self.relayer, &[])
    }

    fn settle(&mut self, intent: &PaymentIntent) -> TxResult {
        let ed = ed_ix_signed_by(&self.owner, intent);
        self.settle_raw(ed, intent, intent.merchant)
    }

    fn withdraw(&mut self) -> TxResult {
        let owner = pk(&self.owner.pubkey());
        let ix = withdraw_ix(&owner, &self.reservation);
        send(&mut self.svm, &[ix], &self.relayer, &[&self.owner])
    }

    fn withdraw_as(&mut self, who: &Keypair) -> TxResult {
        let who_pk = pk(&who.pubkey());
        let ix = withdraw_ix(&who_pk, &self.reservation);
        send(&mut self.svm, &[ix], &self.relayer, &[who])
    }
}

#[test]
fn reserve_locks_funds_and_emits_event() {
    let f = Fixture::default();

    let r = f.reservation_state().expect("reservation exists");
    assert_eq!(r.owner, pk(&f.owner.pubkey()));
    assert_eq!(r.capacity, CAPACITY);
    assert_eq!(r.committed, 0);
    assert_eq!(r.per_payment_cap, PER_PAYMENT_CAP);
    assert_eq!(r.rent_reserve, f.payment_rent * MAX_PAYMENTS as u64);
    assert_eq!(r.expires_at, f.expires_at);
    assert_eq!(r.settle_deadline, f.settle_deadline);

    assert_eq!(
        f.lamports(&f.reservation),
        f.reservation_rent + CAPACITY + r.rent_reserve,
        "lamport invariant must hold with equality at creation"
    );

    let evs = events::<ReservationCreated>(&f.reserve_logs);
    assert_eq!(evs.len(), 1);
    let e = &evs[0];
    assert_eq!(e.reservation, f.reservation);
    assert_eq!(e.owner, pk(&f.owner.pubkey()));
    assert_eq!(e.reservation_id, RESERVATION_ID);
    assert_eq!(e.capacity, CAPACITY);
    assert_eq!(e.per_payment_cap, PER_PAYMENT_CAP);
    assert_eq!(e.rent_reserve, r.rent_reserve);
    assert_eq!(e.max_payments, MAX_PAYMENTS);
    assert_eq!(e.created_at, BASE_TS);
    assert_eq!(e.expires_at, f.expires_at);
    assert_eq!(e.settle_deadline, f.settle_deadline);
}

#[test]
fn settle_pays_merchant_records_payment_and_emits_event() {
    let mut f = Fixture::default();
    let intent = f.intent(1, 250_000_000, 0, 250_000_000);
    let merchant_pk = pk(&f.merchant.pubkey());
    let merchant_before = f.lamports(&merchant_pk);

    let meta = f.settle(&intent).expect("settle should succeed");

    assert_eq!(f.lamports(&merchant_pk), merchant_before + 250_000_000);

    let r = f.reservation_state().unwrap();
    assert_eq!(r.committed, 250_000_000);
    assert_eq!(r.payments_settled, 1);
    assert_eq!(r.rent_reserve, f.payment_rent * (MAX_PAYMENTS as u64 - 1));
    assert_eq!(
        f.lamports(&f.reservation),
        f.reservation_rent + (CAPACITY - 250_000_000) + r.rent_reserve,
        "lamport invariant must hold with equality after settle"
    );

    let p = f.payment_state(&intent).expect("payment record exists");
    assert_eq!(p.payer, pk(&f.owner.pubkey()));
    assert_eq!(p.merchant, merchant_pk);
    assert_eq!(p.amount, 250_000_000);
    assert_eq!(p.reservation, f.reservation);
    assert_eq!(p.sequence, 0);
    assert_eq!(p.intent_created_at, intent.created_at);

    let evs = events::<PaymentSettled>(&meta.logs);
    assert_eq!(evs.len(), 1);
    let e = &evs[0];
    assert_eq!(e.reservation, f.reservation);
    assert_eq!(e.payment, payment_pda(&f.reservation, &intent.payment_id));
    assert_eq!(e.payment_id, intent.payment_id);
    assert_eq!(e.payer, pk(&f.owner.pubkey()));
    assert_eq!(e.merchant, merchant_pk);
    assert_eq!(e.settler, pk(&f.relayer.pubkey()));
    assert_eq!(e.amount, 250_000_000);
    assert_eq!(e.sequence, 0);
    assert_eq!(e.committed_total, 250_000_000);
    assert_eq!(e.payments_settled, 1);
}

#[test]
fn settle_replay_is_rejected() {
    let mut f = Fixture::default();
    let intent = f.intent(1, 100_000_000, 0, 100_000_000);
    f.settle(&intent).expect("first settle");
    let merchant_pk = pk(&f.merchant.pubkey());
    let merchant_after_first = f.lamports(&merchant_pk);

    expect_log(f.settle(&intent), "already in use");
    assert_eq!(f.lamports(&merchant_pk), merchant_after_first);
    assert_eq!(f.reservation_state().unwrap().committed, 100_000_000);
}

#[test]
fn oversubscription_is_rejected_and_state_unchanged() {
    let mut f = Fixture::default();
    let first = f.intent(1, 700_000_000, 0, 700_000_000);
    f.settle(&first).expect("first 0.7 SOL");

    let merchant_pk = pk(&f.merchant.pubkey());
    let merchant_before = f.lamports(&merchant_pk);
    let second = f.intent(2, 700_000_000, 1, CAPACITY);
    expect_err(f.settle(&second), "InsufficientCapacity");

    assert_eq!(f.lamports(&merchant_pk), merchant_before);
    assert_eq!(f.reservation_state().unwrap().committed, 700_000_000);
    assert!(f.payment_state(&second).is_none());

    let third = f.intent(3, 300_000_000, 1, CAPACITY);
    f.settle(&third).expect("exactly exhausts capacity");
    assert_eq!(f.reservation_state().unwrap().committed, CAPACITY);
}

#[test]
fn per_payment_cap_is_enforced() {
    let mut f = Fixture::new(CAPACITY, 300_000_000, MAX_PAYMENTS);
    let over = f.intent(1, 300_000_001, 0, 300_000_001);
    expect_err(f.settle(&over), "ExceedsPerPaymentCap");
}

#[test]
fn rent_reserve_limits_the_number_of_payments() {
    let mut f = Fixture::new(CAPACITY, PER_PAYMENT_CAP, 1);
    let first = f.intent(1, 10_000_000, 0, 10_000_000);
    f.settle(&first).expect("first payment uses the only prepaid receipt");

    let second = f.intent(2, 10_000_000, 1, 20_000_000);
    expect_err(f.settle(&second), "RentReserveExhausted");
    assert_eq!(f.reservation_state().unwrap().payments_settled, 1);
}

#[test]
fn settle_is_allowed_at_the_deadline_and_rejected_after() {
    let mut f = Fixture::default();
    let first = f.intent(1, 100_000_000, 0, 100_000_000);
    let second = f.intent(2, 100_000_000, 1, 200_000_000);

    f.warp_to(f.settle_deadline);
    f.settle(&first).expect("settle exactly at the deadline");

    f.warp_to(f.settle_deadline + 1);
    expect_err(f.settle(&second), "SettleWindowClosed");
    assert!(f.payment_state(&second).is_none());
}

#[test]
fn intent_expiry_is_not_enforced_on_chain_before_the_deadline() {
    let mut f = Fixture::default();
    let intent = f.intent(1, 100_000_000, 0, 100_000_000);

    f.warp_to(f.expires_at + 100);
    f.settle(&intent).expect("an expired intent can still settle inside the grace window");
}

#[test]
fn settle_rejects_wrong_merchant_account() {
    let mut f = Fixture::default();
    let intent = f.intent(1, 100_000_000, 0, 100_000_000);
    let ed = ed_ix_signed_by(&f.owner, &intent);
    let impostor = Pubkey::new_unique();

    expect_err(f.settle_raw(ed, &intent, impostor), "MerchantMismatch");
    assert!(f.payment_state(&intent).is_none());
}

#[test]
fn settle_rejects_payer_that_is_not_the_reservation_owner() {
    let mut f = Fixture::default();
    let attacker = Keypair::new();
    let mut intent = f.intent(1, 100_000_000, 0, 100_000_000);
    intent.payer = pk(&attacker.pubkey());
    let ed = ed_ix_signed_by(&attacker, &intent);

    expect_err(f.settle_raw(ed, &intent, intent.merchant), "PayerMismatch");
}

#[test]
fn settle_rejects_intent_signed_by_someone_else() {
    let mut f = Fixture::default();
    let attacker = Keypair::new();
    let intent = f.intent(1, 100_000_000, 0, 100_000_000);
    let merchant_pk = pk(&f.merchant.pubkey());
    let merchant_before = f.lamports(&merchant_pk);
    let ed = ed_ix_signed_by(&attacker, &intent);

    assert!(f.settle_raw(ed, &intent, intent.merchant).is_err());
    assert!(f.payment_state(&intent).is_none());
    assert_eq!(f.lamports(&merchant_pk), merchant_before);
}

#[test]
fn settle_rejects_a_tampered_intent() {
    let mut f = Fixture::default();
    let signed = f.intent(1, 100_000_000, 0, 100_000_000);
    let ed = ed_ix_signed_by(&f.owner, &signed);

    let mut tampered = signed.clone();
    tampered.amount = 500_000_000;
    tampered.committed_after = 500_000_000;

    let merchant_pk = pk(&f.merchant.pubkey());
    let merchant_before = f.lamports(&merchant_pk);
    assert!(f.settle_raw(ed, &tampered, tampered.merchant).is_err());
    assert!(f.payment_state(&tampered).is_none());
    assert_eq!(f.lamports(&merchant_pk), merchant_before);
}

#[test]
fn settle_rejects_missing_signature_instruction() {
    let mut f = Fixture::default();
    let intent = f.intent(1, 100_000_000, 0, 100_000_000);
    let relayer_pk = pk(&f.relayer.pubkey());
    let ix = settle_ix(&relayer_pk, &intent.merchant, &intent);

    assert!(send(&mut f.svm, &[ix], &f.relayer, &[]).is_err());
    assert!(f.payment_state(&intent).is_none());
}

#[test]
fn settle_rejects_intent_that_predates_the_reservation() {
    let mut f = Fixture::default();
    let mut intent = f.intent(1, 100_000_000, 0, 100_000_000);
    intent.created_at = f.created_at - 1;

    expect_err(f.settle(&intent), "InvalidIntentWindow");
}

#[test]
fn settle_rejects_intent_outliving_the_reservation() {
    let mut f = Fixture::default();
    let mut intent = f.intent(1, 100_000_000, 0, 100_000_000);
    intent.expires_at = f.expires_at + 1;

    expect_err(f.settle(&intent), "InvalidIntentWindow");
}

#[test]
fn settle_rejects_wrong_cluster_and_version() {
    let mut f = Fixture::default();

    let mut wrong_cluster = f.intent(1, 100_000_000, 0, 100_000_000);
    wrong_cluster.cluster = CLUSTER_ID + 1;
    expect_err(f.settle(&wrong_cluster), "WrongCluster");

    let mut wrong_version = f.intent(2, 100_000_000, 0, 100_000_000);
    wrong_version.version = INTENT_VERSION + 1;
    expect_err(f.settle(&wrong_version), "UnsupportedVersion");
}

#[test]
fn withdraw_is_blocked_until_strictly_after_the_deadline() {
    let mut f = Fixture::default();

    expect_err(f.withdraw(), "WithdrawTooEarly");

    f.warp_to(f.expires_at);
    expect_err(f.withdraw(), "WithdrawTooEarly");

    f.warp_to(f.settle_deadline);
    expect_err(f.withdraw(), "WithdrawTooEarly");

    f.warp_to(f.settle_deadline + 1);
    f.withdraw().expect("withdraw after the deadline");
    assert!(f.reservation_state().is_none());
}

#[test]
fn withdraw_requires_the_owner() {
    let mut f = Fixture::default();
    f.warp_to(f.settle_deadline + 1);

    let attacker = Keypair::new();
    f.svm.airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL).unwrap();

    expect_err(f.withdraw_as(&attacker), "NotReservationOwner");
    assert!(f.reservation_state().is_some());
}

#[test]
fn withdraw_refunds_everything_and_emits_event() {
    let mut f = Fixture::default();
    let intent = f.intent(1, 250_000_000, 0, 250_000_000);
    f.settle(&intent).expect("settle before withdrawing");

    f.warp_to(f.settle_deadline + 1);

    let reservation_lamports = f.lamports(&f.reservation);
    let rent_reserve_left = f.payment_rent * (MAX_PAYMENTS as u64 - 1);
    assert_eq!(
        reservation_lamports,
        f.reservation_rent + (CAPACITY - 250_000_000) + rent_reserve_left
    );

    let owner_pk = pk(&f.owner.pubkey());
    let owner_before = f.lamports(&owner_pk);
    let meta = f.withdraw().expect("withdraw");

    assert_eq!(f.lamports(&owner_pk), owner_before + reservation_lamports);
    assert_eq!(f.lamports(&f.reservation), 0);
    assert!(f.reservation_state().is_none());

    let evs = events::<ReservationWithdrawn>(&meta.logs);
    assert_eq!(evs.len(), 1);
    let e = &evs[0];
    assert_eq!(e.reservation, f.reservation);
    assert_eq!(e.owner, owner_pk);
    assert_eq!(e.reservation_id, RESERVATION_ID);
    assert_eq!(e.capacity, CAPACITY);
    assert_eq!(e.committed, 250_000_000);
    assert_eq!(e.payments_settled, 1);
    assert_eq!(e.unused_capacity, CAPACITY - 250_000_000);
    assert_eq!(e.unused_rent_reserve, rent_reserve_left);
    assert_eq!(e.refunded_lamports, reservation_lamports);
    assert_eq!(e.withdrawn_at, f.settle_deadline + 1);
}

#[test]
fn payment_record_outlives_the_withdrawn_reservation() {
    let mut f = Fixture::default();
    let intent = f.intent(1, 250_000_000, 0, 250_000_000);
    f.settle(&intent).unwrap();

    f.warp_to(f.settle_deadline + 1);
    f.withdraw().unwrap();

    let p = f.payment_state(&intent).expect("merchant can still prove payment");
    assert_eq!(p.amount, 250_000_000);
    assert_eq!(p.payer, pk(&f.owner.pubkey()));
    assert_eq!(p.merchant, pk(&f.merchant.pubkey()));
}

#[test]
fn settle_after_withdraw_fails() {
    let mut f = Fixture::default();
    f.warp_to(f.settle_deadline + 1);
    f.withdraw().unwrap();

    let intent = f.intent(1, 100_000_000, 0, 100_000_000);
    assert!(f.settle(&intent).is_err());
}

#[test]
fn debug_ed25519_precompile_account() {
    let svm = LiteSVM::new().with_precompiles();
    match svm.get_account(&ed25519_program::ID) {
        Some(a) => println!(
            "ed25519 account FOUND: executable={} owner={} lamports={} data_len={}",
            a.executable,
            a.owner,
            a.lamports,
            a.data.len()
        ),
        None => println!("ed25519 account MISSING"),
    }
}
