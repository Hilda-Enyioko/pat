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
use pat::events::{MerchantRegistered, PaymentSettled, ReservationCreated, ReservationWithdrawn};
use pat::state::{Config, Merchant, Payment, PaymentIntent, PaymentRail, Reservation};

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

// ═════════════════════ USSD rail: helpers ═════════════════════

const MERCHANT_CODE: u32 = 4242;
const DELEGATED_RESERVATION_ID: u64 = 77;

fn new_svm() -> LiteSVM {
    let mut svm = LiteSVM::new().with_precompiles();
    svm.add_program_from_file(pat::ID, PROGRAM_SO)
        .expect("program binary missing; run `anchor build` first");
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = BASE_TS;
    svm.set_sysvar(&clock);
    svm
}

fn funded(svm: &mut LiteSVM) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
    k
}

fn account_exists(svm: &LiteSVM, key: &Pubkey) -> bool {
    svm.get_account(&addr(key)).map(|a| a.lamports > 0).unwrap_or(false)
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &pat::ID).0
}

fn merchant_pda(code: u32) -> Pubkey {
    Pubkey::find_program_address(&[MERCHANT_SEED, &code.to_le_bytes()], &pat::ID).0
}

fn reservation_pda(owner: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[RESERVATION_SEED, owner.as_ref(), &id.to_le_bytes()],
        &pat::ID,
    )
    .0
}

fn init_config_ix(admin: &Pubkey) -> Instruction {
    Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::InitConfig {
            admin: *admin,
            config: config_pda(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pat::instruction::InitConfig {}.data(),
    }
}

fn register_merchant_ix(admin: &Pubkey, code: u32, payout: Pubkey) -> Instruction {
    Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::RegisterMerchant {
            admin: *admin,
            config: config_pda(),
            merchant_entry: merchant_pda(code),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pat::instruction::RegisterMerchant { code, payout }.data(),
    }
}

fn setup_registry(svm: &mut LiteSVM, admin: &Keypair, code: u32, payout: &Pubkey) {
    let admin_pk = pk(&admin.pubkey());
    send(svm, &[init_config_ix(&admin_pk)], admin, &[]).expect("init_config");
    send(svm, &[register_merchant_ix(&admin_pk, code, *payout)], admin, &[])
        .expect("register_merchant");
}

#[allow(clippy::too_many_arguments)]
fn reserve_delegated_tx(
    svm: &mut LiteSVM,
    owner: &Keypair,
    id: u64,
    capacity: u64,
    per_payment_cap: u64,
    expires_at: i64,
    max_payments: u32,
    delegate: Pubkey,
) -> TxResult {
    let owner_pk = pk(&owner.pubkey());
    let ix = Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::Reserve {
            owner: owner_pk,
            reservation: reservation_pda(&owner_pk, id),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pat::instruction::ReserveDelegated {
            reservation_id: id,
            capacity,
            per_payment_cap,
            expires_at,
            max_payments,
            delegate,
        }
        .data(),
    };
    send(svm, &[ix], owner, &[])
}

fn settle_delegated_ix(
    delegate: &Pubkey,
    reservation: &Pubkey,
    code: u32,
    merchant_account: &Pubkey,
    payment_id: [u8; 32],
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::SettleDelegated {
            delegate: *delegate,
            reservation: *reservation,
            merchant_entry: merchant_pda(code),
            merchant: *merchant_account,
            payment: payment_pda(reservation, &payment_id),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pat::instruction::SettleDelegated { payment_id, amount }.data(),
    }
}

/// `signer` is both the transaction fee payer and the `delegate` account.
fn settle_delegated_tx(
    svm: &mut LiteSVM,
    signer: &Keypair,
    reservation: &Pubkey,
    code: u32,
    merchant_account: &Pubkey,
    payment_id: [u8; 32],
    amount: u64,
) -> TxResult {
    let ix = settle_delegated_ix(
        &pk(&signer.pubkey()),
        reservation,
        code,
        merchant_account,
        payment_id,
        amount,
    );
    send(svm, &[ix], signer, &[])
}

struct DFixture {
    svm: LiteSVM,
    owner: Keypair,
    keeper: Keypair, // the delegate
    admin: Keypair,
    merchant: Keypair, // registered payout wallet
    reservation: Pubkey,
    expires_at: i64,
    payment_rent: u64,
    reservation_rent: u64,
    reserve_logs: Vec<String>,
}

impl DFixture {
    fn new() -> Self {
        Self::with(CAPACITY, PER_PAYMENT_CAP, MAX_PAYMENTS)
    }

    fn with(capacity: u64, per_payment_cap: u64, max_payments: u32) -> Self {
        let mut svm = new_svm();
        let owner = funded(&mut svm);
        let keeper = funded(&mut svm);
        let admin = funded(&mut svm);
        let merchant = funded(&mut svm);

        setup_registry(&mut svm, &admin, MERCHANT_CODE, &pk(&merchant.pubkey()));

        let expires_at = BASE_TS + 3_600;
        let meta = reserve_delegated_tx(
            &mut svm,
            &owner,
            DELEGATED_RESERVATION_ID,
            capacity,
            per_payment_cap,
            expires_at,
            max_payments,
            pk(&keeper.pubkey()),
        )
        .expect("reserve_delegated should succeed");

        let reservation = reservation_pda(&pk(&owner.pubkey()), DELEGATED_RESERVATION_ID);
        let payment_rent = svm.minimum_balance_for_rent_exemption(Payment::SPACE);
        let reservation_rent = svm.minimum_balance_for_rent_exemption(Reservation::SPACE);

        Self {
            svm,
            owner,
            keeper,
            admin,
            merchant,
            reservation,
            expires_at,
            payment_rent,
            reservation_rent,
            reserve_logs: meta.logs,
        }
    }

    fn settle_deadline(&self) -> i64 {
        self.expires_at + SETTLE_GRACE_SECS
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

    fn payment_state(&self, id: u8) -> Option<Payment> {
        let pda = payment_pda(&self.reservation, &[id; 32]);
        let acct = self.svm.get_account(&addr(&pda))?;
        if acct.lamports == 0 {
            return None;
        }
        Payment::try_deserialize(&mut &acct.data[..]).ok()
    }

    /// The keeper (delegate) settles a payment to the registered merchant.
    fn settle(&mut self, id: u8, amount: u64) -> TxResult {
        settle_delegated_tx(
            &mut self.svm,
            &self.keeper,
            &self.reservation,
            MERCHANT_CODE,
            &pk(&self.merchant.pubkey()),
            [id; 32],
            amount,
        )
    }
}

// ═════════════════════ USSD rail: tests ═════════════════════

#[test]
fn reserve_delegated_records_delegate_and_emits_event() {
    let f = DFixture::new();
    let keeper_pk = pk(&f.keeper.pubkey());

    let r = f.reservation_state().expect("reservation exists");
    assert_eq!(r.delegate, Some(keeper_pk));
    assert_eq!(r.capacity, CAPACITY);
    assert_eq!(
        f.lamports(&f.reservation),
        f.reservation_rent + CAPACITY + r.rent_reserve,
        "lamport invariant must hold with equality at creation"
    );

    let evs = events::<ReservationCreated>(&f.reserve_logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].delegate, Some(keeper_pk));
}

#[test]
fn reserve_delegated_rejects_owner_or_default_key_as_delegate() {
    let mut svm = new_svm();
    let owner = funded(&mut svm);
    let owner_pk = pk(&owner.pubkey());
    let expires_at = BASE_TS + 3_600;

    let res = reserve_delegated_tx(
        &mut svm, &owner, 1, CAPACITY, PER_PAYMENT_CAP, expires_at, MAX_PAYMENTS, owner_pk,
    );
    expect_err(res, "InvalidDelegate");

    let res = reserve_delegated_tx(
        &mut svm, &owner, 1, CAPACITY, PER_PAYMENT_CAP, expires_at, MAX_PAYMENTS, Pubkey::default(),
    );
    expect_err(res, "InvalidDelegate");

    assert!(!account_exists(&svm, &reservation_pda(&owner_pk, 1)));
}

#[test]
fn settle_delegated_pays_merchant_records_ussd_rail_and_emits_event() {
    let mut f = DFixture::new();
    let merchant_pk = pk(&f.merchant.pubkey());
    let merchant_before = f.lamports(&merchant_pk);

    let meta = f.settle(1, 250_000_000).expect("delegated settle should succeed");

    assert_eq!(f.lamports(&merchant_pk), merchant_before + 250_000_000);

    let r = f.reservation_state().unwrap();
    assert_eq!(r.committed, 250_000_000);
    assert_eq!(r.payments_settled, 1);
    assert_eq!(r.rent_reserve, f.payment_rent * (MAX_PAYMENTS as u64 - 1));
    assert_eq!(
        f.lamports(&f.reservation),
        f.reservation_rent + (CAPACITY - 250_000_000) + r.rent_reserve,
        "lamport invariant must hold with equality after delegated settle"
    );

    let p = f.payment_state(1).expect("payment record exists");
    assert_eq!(p.rail, PaymentRail::Ussd);
    assert_eq!(p.payer, pk(&f.owner.pubkey()));
    assert_eq!(p.merchant, merchant_pk);
    assert_eq!(p.amount, 250_000_000);
    assert_eq!(p.reservation, f.reservation);
    assert_eq!(p.sequence, 0);

    let evs = events::<PaymentSettled>(&meta.logs);
    assert_eq!(evs.len(), 1);
    let e = &evs[0];
    assert_eq!(e.rail, PaymentRail::Ussd);
    assert_eq!(e.settler, pk(&f.keeper.pubkey()));
    assert_eq!(e.payer, pk(&f.owner.pubkey()));
    assert_eq!(e.merchant, merchant_pk);
    assert_eq!(e.payment_id, [1u8; 32]);
    assert_eq!(e.amount, 250_000_000);
    assert_eq!(e.committed_total, 250_000_000);
    assert_eq!(e.payments_settled, 1);
}

#[test]
fn settle_delegated_rejects_a_signer_that_is_not_the_delegate() {
    let mut f = DFixture::new();
    let merchant_pk = pk(&f.merchant.pubkey());
    let merchant_before = f.lamports(&merchant_pk);
    let attacker = funded(&mut f.svm);

    let res = settle_delegated_tx(
        &mut f.svm, &attacker, &f.reservation, MERCHANT_CODE, &merchant_pk, [1u8; 32], 100_000_000,
    );
    expect_err(res, "NotDelegate");

    // The owner's own key has no authority on the delegated path either.
    let res = settle_delegated_tx(
        &mut f.svm, &f.owner, &f.reservation, MERCHANT_CODE, &merchant_pk, [2u8; 32], 100_000_000,
    );
    expect_err(res, "NotDelegate");

    assert_eq!(f.lamports(&merchant_pk), merchant_before);
    assert!(f.payment_state(1).is_none() && f.payment_state(2).is_none());
    assert_eq!(f.reservation_state().unwrap().committed, 0);
}

#[test]
fn settle_delegated_enforces_per_payment_cap() {
    let mut f = DFixture::with(CAPACITY, 300_000_000, MAX_PAYMENTS);
    expect_err(f.settle(1, 300_000_001), "ExceedsPerPaymentCap");
    f.settle(2, 300_000_000).expect("exactly at the cap is allowed");
}

#[test]
fn settle_delegated_rejects_zero_amount() {
    let mut f = DFixture::new();
    expect_err(f.settle(1, 0), "ZeroAmount");
}

#[test]
fn settle_delegated_over_capacity_is_rejected_and_state_unchanged() {
    let mut f = DFixture::new();
    let merchant_pk = pk(&f.merchant.pubkey());

    f.settle(1, 700_000_000).expect("first 0.7 SOL");
    let merchant_before = f.lamports(&merchant_pk);

    expect_err(f.settle(2, 700_000_000), "InsufficientCapacity");
    assert_eq!(f.lamports(&merchant_pk), merchant_before);
    assert_eq!(f.reservation_state().unwrap().committed, 700_000_000);
    assert!(f.payment_state(2).is_none());

    f.settle(3, 300_000_000).expect("exactly exhausts capacity");
    assert_eq!(f.reservation_state().unwrap().remaining(), 0);
}

#[test]
fn settle_delegated_rejects_unregistered_merchant_code() {
    let mut f = DFixture::new();
    let merchant_pk = pk(&f.merchant.pubkey());
    let merchant_before = f.lamports(&merchant_pk);

    let res = settle_delegated_tx(
        &mut f.svm, &f.keeper, &f.reservation, 9_999, &merchant_pk, [1u8; 32], 100_000_000,
    );
    expect_err(res, "AccountNotInitialized");

    assert_eq!(f.lamports(&merchant_pk), merchant_before);
    assert!(f.payment_state(1).is_none());
}

#[test]
fn settle_delegated_rejects_a_payout_that_is_not_the_registered_one() {
    let mut f = DFixture::new();
    let impostor = Pubkey::new_unique();

    let res = settle_delegated_tx(
        &mut f.svm, &f.keeper, &f.reservation, MERCHANT_CODE, &impostor, [1u8; 32], 100_000_000,
    );
    expect_err(res, "MerchantMismatch");
    assert!(f.payment_state(1).is_none());
    assert_eq!(f.reservation_state().unwrap().committed, 0);
}

#[test]
fn settle_delegated_double_settle_is_rejected() {
    let mut f = DFixture::new();
    let merchant_pk = pk(&f.merchant.pubkey());

    f.settle(1, 100_000_000).expect("first settle");
    let merchant_after_first = f.lamports(&merchant_pk);

    expect_log(f.settle(1, 100_000_000), "already in use");

    assert_eq!(f.lamports(&merchant_pk), merchant_after_first);
    let r = f.reservation_state().unwrap();
    assert_eq!(r.committed, 100_000_000);
    assert_eq!(r.payments_settled, 1);
}

#[test]
fn settle_delegated_is_rejected_at_expiry_with_no_grace_window() {
    let mut f = DFixture::new();

    f.warp_to(f.expires_at - 1);
    f.settle(1, 100_000_000).expect("last second of the spending window");

    f.warp_to(f.expires_at);
    expect_err(f.settle(2, 100_000_000), "ReservationExpired");

    // Inside the QR rail's grace window, but this rail gets none.
    f.warp_to(f.expires_at + 60);
    expect_err(f.settle(3, 100_000_000), "ReservationExpired");

    assert_eq!(f.reservation_state().unwrap().committed, 100_000_000);
    assert!(f.payment_state(2).is_none() && f.payment_state(3).is_none());
}

// ───────── rail separation, both directions ─────────

#[test]
fn settle_delegated_rejects_a_qr_reservation() {
    let mut f = Fixture::default(); // plain reserve: no delegate
    let admin = funded(&mut f.svm);
    let merchant_pk = pk(&f.merchant.pubkey());
    setup_registry(&mut f.svm, &admin, MERCHANT_CODE, &merchant_pk);

    let res = settle_delegated_tx(
        &mut f.svm, &f.relayer, &f.reservation, MERCHANT_CODE, &merchant_pk, [5u8; 32], 100_000_000,
    );
    expect_err(res, "ReservationNotDelegated");
    assert_eq!(f.reservation_state().unwrap().committed, 0);
}

#[test]
fn settle_rejects_a_delegated_reservation_even_with_a_valid_signed_intent() {
    let mut f = DFixture::new();
    let owner_pk = pk(&f.owner.pubkey());
    let merchant_pk = pk(&f.merchant.pubkey());

    let intent = PaymentIntent {
        version: INTENT_VERSION,
        cluster: CLUSTER_ID,
        payment_id: [9u8; 32],
        payer: owner_pk,
        merchant: merchant_pk,
        reservation: f.reservation,
        amount: 100_000_000,
        created_at: BASE_TS + 10,
        expires_at: f.expires_at,
        sequence: 0,
        committed_after: 100_000_000,
    };
    let ed = ed_ix_signed_by(&f.owner, &intent);
    let ix = settle_ix(&pk(&f.keeper.pubkey()), &merchant_pk, &intent);

    expect_err(send(&mut f.svm, &[ed, ix], &f.keeper, &[]), "ReservationIsDelegated");
    assert!(f.payment_state(9).is_none());
    assert_eq!(f.reservation_state().unwrap().committed, 0);
}

// ───────── merchant registry ─────────

#[test]
fn register_merchant_stores_payout_and_emits_event() {
    let mut svm = new_svm();
    let admin = funded(&mut svm);
    let admin_pk = pk(&admin.pubkey());
    let payout = Pubkey::new_unique();

    send(&mut svm, &[init_config_ix(&admin_pk)], &admin, &[]).unwrap();
    let meta = send(&mut svm, &[register_merchant_ix(&admin_pk, 7, payout)], &admin, &[]).unwrap();

    let acct = svm.get_account(&addr(&merchant_pda(7))).expect("merchant entry exists");
    let m = Merchant::try_deserialize(&mut &acct.data[..]).unwrap();
    assert_eq!(m.code, 7);
    assert_eq!(m.payout, payout);

    let evs = events::<MerchantRegistered>(&meta.logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].code, 7);
    assert_eq!(evs[0].payout, payout);
    assert_eq!(evs[0].admin, admin_pk);
}

#[test]
fn register_merchant_is_admin_only() {
    let mut svm = new_svm();
    let admin = funded(&mut svm);
    let attacker = funded(&mut svm);
    send(&mut svm, &[init_config_ix(&pk(&admin.pubkey()))], &admin, &[]).unwrap();

    let ix = register_merchant_ix(&pk(&attacker.pubkey()), 1, Pubkey::new_unique());
    expect_err(send(&mut svm, &[ix], &attacker, &[]), "NotAdmin");
    assert!(!account_exists(&svm, &merchant_pda(1)));
}

#[test]
fn register_merchant_rejects_zero_code() {
    let mut svm = new_svm();
    let admin = funded(&mut svm);
    let admin_pk = pk(&admin.pubkey());
    send(&mut svm, &[init_config_ix(&admin_pk)], &admin, &[]).unwrap();

    let ix = register_merchant_ix(&admin_pk, 0, Pubkey::new_unique());
    expect_err(send(&mut svm, &[ix], &admin, &[]), "InvalidMerchantCode");
}

#[test]
fn register_merchant_cannot_overwrite_an_existing_code() {
    let mut svm = new_svm();
    let admin = funded(&mut svm);
    let admin_pk = pk(&admin.pubkey());
    let original = Pubkey::new_unique();
    send(&mut svm, &[init_config_ix(&admin_pk)], &admin, &[]).unwrap();
    send(&mut svm, &[register_merchant_ix(&admin_pk, 5, original)], &admin, &[]).unwrap();

    let ix = register_merchant_ix(&admin_pk, 5, Pubkey::new_unique());
    expect_log(send(&mut svm, &[ix], &admin, &[]), "already in use");

    let acct = svm.get_account(&addr(&merchant_pda(5))).unwrap();
    let m = Merchant::try_deserialize(&mut &acct.data[..]).unwrap();
    assert_eq!(m.payout, original);
}

#[test]
fn init_config_cannot_be_run_twice() {
    let mut svm = new_svm();
    let admin = funded(&mut svm);
    let attacker = funded(&mut svm);
    send(&mut svm, &[init_config_ix(&pk(&admin.pubkey()))], &admin, &[]).unwrap();

    expect_log(
        send(&mut svm, &[init_config_ix(&pk(&attacker.pubkey()))], &attacker, &[]),
        "already in use",
    );
    let acct = svm.get_account(&addr(&config_pda())).unwrap();
    let cfg = Config::try_deserialize(&mut &acct.data[..]).unwrap();
    assert_eq!(cfg.admin, pk(&admin.pubkey()));
}

// ───────── withdraw still works for the delegated rail ─────────

#[test]
fn withdraw_after_delegated_payments_refunds_only_the_unspent_part() {
    let mut f = DFixture::new();
    f.settle(1, 250_000_000).expect("delegated settle");

    f.warp_to(f.settle_deadline() + 1);

    let owner_pk = pk(&f.owner.pubkey());
    let held = f.lamports(&f.reservation);
    let rent_reserve_left = f.payment_rent * (MAX_PAYMENTS as u64 - 1);
    assert_eq!(held, f.reservation_rent + (CAPACITY - 250_000_000) + rent_reserve_left);

    let owner_before = f.lamports(&owner_pk);
    let ix = withdraw_ix(&owner_pk, &f.reservation);
    // keeper pays the fee so the owner's delta is exact
    send(&mut f.svm, &[ix], &f.keeper, &[&f.owner]).expect("withdraw");

    assert_eq!(f.lamports(&owner_pk), owner_before + held);
    assert!(f.reservation_state().is_none());

    let p = f.payment_state(1).expect("merchant can still prove the USSD payment");
    assert_eq!(p.rail, PaymentRail::Ussd);
    assert_eq!(p.amount, 250_000_000);
}
