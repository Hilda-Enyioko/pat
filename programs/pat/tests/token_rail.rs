use anchor_lang::{
    prelude::Pubkey, solana_program::clock::Clock, AccountDeserialize, AnchorDeserialize,
    Discriminator, InstructionData, ToAccountMetas,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

use pat::constants::*;
use pat::events::{
    MerchantRegistered, PaymentSettled, ReservationCreated, TokenReservationWithdrawn,
};
use pat::state::{Config, Merchant, Payment, PaymentRail, Reservation};

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
const PROGRAM_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/pat.so");
const BASE_TS: i64 = 1_700_000_000;
const DECIMALS: u8 = 6;
const CAPACITY: u64 = 1_000_000_000; // 1000 tokens
const PER_PAYMENT_CAP: u64 = 800_000_000;
const OWNER_TOKENS: u64 = 5_000_000_000;
const MAX_PAYMENTS: u32 = 10;
const MERCHANT_CODE: u32 = 4242;
const RESERVATION_ID: u64 = 77;

type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

// ───────────── conversions and send helpers ─────────────

fn pk(a: &Address) -> Pubkey {
    Pubkey::new_from_array(a.to_bytes())
}
fn addr(p: &Pubkey) -> Address {
    Address::new_from_array(p.to_bytes())
}
fn token_program() -> Pubkey {
    Pubkey::new_from_array(anchor_spl::token::ID.to_bytes())
}
fn ata_program() -> Pubkey {
    Pubkey::new_from_array(anchor_spl::associated_token::ID.to_bytes())
}
fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[wallet.as_ref(), token_program().as_ref(), mint.as_ref()],
        &ata_program(),
    )
    .0
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

// ───────────── raw SPL accounts (no spl crate needed) ─────────────

fn put(svm: &mut LiteSVM, key: &Pubkey, data: Vec<u8>) {
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(
        addr(key),
        Account {
            lamports,
            data,
            owner: addr(&token_program()),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// SPL Mint layout, 82 bytes.
fn put_mint(svm: &mut LiteSVM, mint: &Pubkey, authority: &Pubkey, decimals: u8) {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes()); // mint_authority: Some
    d[4..36].copy_from_slice(authority.as_ref());
    d[44] = decimals;
    d[45] = 1; // is_initialized
    put(svm, mint, d);
}

/// SPL token account layout, 165 bytes.
fn put_token(svm: &mut LiteSVM, key: &Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // state: Initialized
    put(svm, key, d);
}

fn token_amount(svm: &LiteSVM, key: &Pubkey) -> Option<u64> {
    let a = svm.get_account(&addr(key))?;
    if a.lamports == 0 || a.data.len() < 72 {
        return None;
    }
    Some(u64::from_le_bytes(a.data[64..72].try_into().unwrap()))
}

fn lamports(svm: &LiteSVM, key: &Pubkey) -> u64 {
    svm.get_balance(&addr(key)).unwrap_or(0)
}

fn account_exists(svm: &LiteSVM, key: &Pubkey) -> bool {
    lamports(svm, key) > 0
}

// ───────────── PDAs and instruction builders ─────────────

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
fn payment_pda(reservation: &Pubkey, payment_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(
        &[PAYMENT_SEED, reservation.as_ref(), payment_id.as_ref()],
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
    mint: &Pubkey,
    capacity: u64,
    per_payment_cap: u64,
    expires_at: i64,
    max_payments: u32,
    delegate: Pubkey,
) -> TxResult {
    let owner_pk = pk(&owner.pubkey());
    let reservation = reservation_pda(&owner_pk, id);
    let ix = Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::ReserveDelegated {
            owner: owner_pk,
            reservation,
            mint: *mint,
            owner_token_account: ata(&owner_pk, mint),
            vault: ata(&reservation, mint),
            token_program: token_program(),
            associated_token_program: ata_program(),
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
    mint: &Pubkey,
    merchant_token: &Pubkey,
    payment_id: [u8; 32],
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::SettleDelegated {
            delegate: *delegate,
            reservation: *reservation,
            merchant_entry: merchant_pda(code),
            mint: *mint,
            vault: ata(reservation, mint),
            merchant_token_account: *merchant_token,
            payment: payment_pda(reservation, &payment_id),
            token_program: token_program(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pat::instruction::SettleDelegated { payment_id, amount }.data(),
    }
}

fn withdraw_token_ix(owner: &Pubkey, reservation: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::WithdrawToken {
            owner: *owner,
            reservation: *reservation,
            mint: *mint,
            vault: ata(reservation, mint),
            owner_token_account: ata(owner, mint),
            token_program: token_program(),
        }
        .to_account_metas(None),
        data: pat::instruction::WithdrawToken {}.data(),
    }
}

fn withdraw_sol_ix(owner: &Pubkey, reservation: &Pubkey) -> Instruction {
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

// ───────────── fixture ─────────────

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

/// Mint + the owner's funded token account, no reservation yet.
fn svm_with_token() -> (LiteSVM, Keypair, Pubkey) {
    let mut svm = new_svm();
    let owner = funded(&mut svm);
    let mint = Pubkey::new_unique();
    put_mint(&mut svm, &mint, &pk(&owner.pubkey()), DECIMALS);
    put_token(&mut svm, &ata(&pk(&owner.pubkey()), &mint), &mint, &pk(&owner.pubkey()), OWNER_TOKENS);
    (svm, owner, mint)
}

struct TFixture {
    svm: LiteSVM,
    owner: Keypair,
    keeper: Keypair, // the delegate
    admin: Keypair,
    payout: Pubkey,
    mint: Pubkey,
    reservation: Pubkey,
    vault: Pubkey,
    merchant_ata: Pubkey,
    owner_ata: Pubkey,
    expires_at: i64,
    payment_rent: u64,
    reservation_rent: u64,
    reserve_logs: Vec<String>,
}

impl TFixture {
    fn new() -> Self {
        Self::with(CAPACITY, PER_PAYMENT_CAP, MAX_PAYMENTS)
    }

    fn with(capacity: u64, per_payment_cap: u64, max_payments: u32) -> Self {
        let (mut svm, owner, mint) = svm_with_token();
        let keeper = funded(&mut svm);
        let admin = funded(&mut svm);
        let owner_pk = pk(&owner.pubkey());
        let payout = Pubkey::new_unique();

        setup_registry(&mut svm, &admin, MERCHANT_CODE, &payout);
        let merchant_ata = ata(&payout, &mint);
        put_token(&mut svm, &merchant_ata, &mint, &payout, 0);

        let expires_at = BASE_TS + 3_600;
        let meta = reserve_delegated_tx(
            &mut svm, &owner, RESERVATION_ID, &mint, capacity, per_payment_cap,
            expires_at, max_payments, pk(&keeper.pubkey()),
        )
        .expect("reserve_delegated should succeed");

        let reservation = reservation_pda(&owner_pk, RESERVATION_ID);
        let payment_rent = svm.minimum_balance_for_rent_exemption(Payment::SPACE);
        let reservation_rent = svm.minimum_balance_for_rent_exemption(Reservation::SPACE);

        Self {
            vault: ata(&reservation, &mint),
            owner_ata: ata(&owner_pk, &mint),
            svm, owner, keeper, admin, payout, mint, reservation, merchant_ata,
            expires_at, payment_rent, reservation_rent,
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

    fn settle_with(&mut self, signer: &Keypair, id: u8, amount: u64) -> TxResult {
        let ix = settle_delegated_ix(
            &pk(&signer.pubkey()), &self.reservation, MERCHANT_CODE, &self.mint,
            &self.merchant_ata, [id; 32], amount,
        );
        send(&mut self.svm, &[ix], signer, &[])
    }

    /// The keeper settles a payment to the registered merchant.
    fn settle(&mut self, id: u8, amount: u64) -> TxResult {
        let keeper = Keypair::try_from(&self.keeper.to_bytes()[..]).unwrap();
        self.settle_with(&keeper, id, amount)
    }

    fn token(&self, key: &Pubkey) -> u64 {
        token_amount(&self.svm, key).unwrap_or(0)
    }

    /// Invariants after every state change: lamports cover rent + rent_reserve,
    /// and the vault covers everything not yet committed.
    fn assert_invariants(&self) {
        let r = self.reservation_state().expect("reservation exists");
        assert_eq!(
            lamports(&self.svm, &self.reservation),
            self.reservation_rent + r.rent_reserve,
            "lamport invariant"
        );
        assert_eq!(
            self.token(&self.vault),
            r.capacity - r.committed,
            "vault must equal capacity minus committed"
        );
    }
}

// ───────────── reserve_delegated ─────────────

#[test]
fn reserve_delegated_moves_tokens_into_the_vault_and_emits_event() {
    let f = TFixture::new();
    let keeper_pk = pk(&f.keeper.pubkey());

    let r = f.reservation_state().expect("reservation exists");
    assert_eq!(r.delegate, Some(keeper_pk));
    assert_eq!(r.mint, Some(f.mint));
    assert_eq!(r.capacity, CAPACITY);
    assert_eq!(r.rent_reserve, f.payment_rent * MAX_PAYMENTS as u64);

    assert_eq!(f.token(&f.vault), CAPACITY);
    assert_eq!(f.token(&f.owner_ata), OWNER_TOKENS - CAPACITY);
    f.assert_invariants();

    let evs = events::<ReservationCreated>(&f.reserve_logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].delegate, Some(keeper_pk));
    assert_eq!(evs[0].mint, Some(f.mint));
}

#[test]
fn reserve_delegated_rejects_owner_or_default_key_as_delegate() {
    let (mut svm, owner, mint) = svm_with_token();
    let owner_pk = pk(&owner.pubkey());
    let expires_at = BASE_TS + 3_600;

    let res = reserve_delegated_tx(
        &mut svm, &owner, 1, &mint, CAPACITY, PER_PAYMENT_CAP, expires_at, MAX_PAYMENTS, owner_pk,
    );
    expect_err(res, "InvalidDelegate");

    let res = reserve_delegated_tx(
        &mut svm, &owner, 1, &mint, CAPACITY, PER_PAYMENT_CAP, expires_at, MAX_PAYMENTS,
        Pubkey::default(),
    );
    expect_err(res, "InvalidDelegate");

    assert!(!account_exists(&svm, &reservation_pda(&owner_pk, 1)));
    assert!(!account_exists(&svm, &ata(&reservation_pda(&owner_pk, 1), &mint)));
}

// ───────────── settle_delegated ─────────────

#[test]
fn settle_delegated_pays_merchant_tokens_and_records_the_payment() {
    let mut f = TFixture::new();
    let keeper_pk = pk(&f.keeper.pubkey());
    let merchant_before = f.token(&f.merchant_ata);

    let meta = f.settle(1, 250_000_000).expect("delegated settle should succeed");

    assert_eq!(f.token(&f.merchant_ata), merchant_before + 250_000_000);
    assert_eq!(f.token(&f.vault), CAPACITY - 250_000_000);

    let r = f.reservation_state().unwrap();
    assert_eq!(r.committed, 250_000_000);
    assert_eq!(r.payments_settled, 1);
    assert_eq!(r.rent_reserve, f.payment_rent * (MAX_PAYMENTS as u64 - 1));
    f.assert_invariants();

    let p = f.payment_state(1).expect("payment record exists");
    assert_eq!(p.rail, PaymentRail::Ussd);
    assert_eq!(p.payer, pk(&f.owner.pubkey()));
    assert_eq!(p.merchant, f.payout);
    assert_eq!(p.amount, 250_000_000);
    assert_eq!(p.reservation, f.reservation);
    assert_eq!(p.mint, Some(f.mint));

    let evs = events::<PaymentSettled>(&meta.logs);
    assert_eq!(evs.len(), 1);
    let e = &evs[0];
    assert_eq!(e.rail, PaymentRail::Ussd);
    assert_eq!(e.settler, keeper_pk);
    assert_eq!(e.merchant, f.payout);
    assert_eq!(e.amount, 250_000_000);
    assert_eq!(e.committed_total, 250_000_000);
    assert_eq!(e.mint, Some(f.mint));
}

#[test]
fn settle_delegated_rejects_a_signer_that_is_not_the_delegate() {
    let mut f = TFixture::new();
    let attacker = funded(&mut f.svm);
    let merchant_before = f.token(&f.merchant_ata);

    expect_err(f.settle_with(&attacker, 1, 100_000_000), "NotDelegate");

    // The owner's own key has no authority on the delegated path either.
    let owner = Keypair::try_from(&f.owner.to_bytes()[..]).unwrap();
    expect_err(f.settle_with(&owner, 2, 100_000_000), "NotDelegate");

    assert_eq!(f.token(&f.merchant_ata), merchant_before);
    assert!(f.payment_state(1).is_none() && f.payment_state(2).is_none());
    f.assert_invariants();
}

#[test]
fn settle_delegated_enforces_per_payment_cap() {
    let mut f = TFixture::with(CAPACITY, 300_000_000, MAX_PAYMENTS);
    expect_err(f.settle(1, 300_000_001), "ExceedsPerPaymentCap");
    f.settle(2, 300_000_000).expect("exactly at the cap is allowed");
}

#[test]
fn settle_delegated_rejects_zero_amount() {
    let mut f = TFixture::new();
    expect_err(f.settle(1, 0), "ZeroAmount");
}

#[test]
fn settle_delegated_over_capacity_is_rejected_and_state_unchanged() {
    let mut f = TFixture::new();
    f.settle(1, 700_000_000).expect("first 700 tokens");
    let merchant_before = f.token(&f.merchant_ata);

    expect_err(f.settle(2, 700_000_000), "InsufficientCapacity");
    assert_eq!(f.token(&f.merchant_ata), merchant_before);
    assert_eq!(f.reservation_state().unwrap().committed, 700_000_000);
    assert!(f.payment_state(2).is_none());
    f.assert_invariants();

    f.settle(3, 300_000_000).expect("exactly exhausts capacity");
    assert_eq!(f.reservation_state().unwrap().remaining(), 0);
    assert_eq!(f.token(&f.vault), 0);
}

#[test]
fn settle_delegated_rejects_unregistered_merchant_code() {
    let mut f = TFixture::new();
    let ix = settle_delegated_ix(
        &pk(&f.keeper.pubkey()), &f.reservation, 9_999, &f.mint, &f.merchant_ata,
        [1u8; 32], 100_000_000,
    );
    let keeper = Keypair::try_from(&f.keeper.to_bytes()[..]).unwrap();
    expect_err(send(&mut f.svm, &[ix], &keeper, &[]), "AccountNotInitialized");
    assert!(f.payment_state(1).is_none());
}

#[test]
fn settle_delegated_rejects_a_token_account_not_owned_by_the_registered_payout() {
    let mut f = TFixture::new();
    let stranger = Pubkey::new_unique();
    let stranger_token = Pubkey::new_unique();
    put_token(&mut f.svm, &stranger_token, &f.mint, &stranger, 0);

    let ix = settle_delegated_ix(
        &pk(&f.keeper.pubkey()), &f.reservation, MERCHANT_CODE, &f.mint, &stranger_token,
        [1u8; 32], 100_000_000,
    );
    let keeper = Keypair::try_from(&f.keeper.to_bytes()[..]).unwrap();
    expect_err(send(&mut f.svm, &[ix], &keeper, &[]), "MerchantMismatch");
    assert_eq!(f.token(&stranger_token), 0);
    f.assert_invariants();
}

#[test]
fn settle_delegated_rejects_a_mint_that_is_not_the_reservations() {
    let mut f = TFixture::new();
    let other_mint = Pubkey::new_unique();
    let owner_pk = pk(&f.owner.pubkey());
    put_mint(&mut f.svm, &other_mint, &owner_pk, DECIMALS);
    // Give the attacker a fully consistent set of accounts for the wrong mint.
    put_token(&mut f.svm, &ata(&f.reservation, &other_mint), &other_mint, &f.reservation, 500_000_000);
    let other_merchant_ata = ata(&f.payout, &other_mint);
    put_token(&mut f.svm, &other_merchant_ata, &other_mint, &f.payout, 0);

    let ix = settle_delegated_ix(
        &pk(&f.keeper.pubkey()), &f.reservation, MERCHANT_CODE, &other_mint,
        &other_merchant_ata, [1u8; 32], 100_000_000,
    );
    let keeper = Keypair::try_from(&f.keeper.to_bytes()[..]).unwrap();
    expect_err(send(&mut f.svm, &[ix], &keeper, &[]), "MintMismatch");
    assert_eq!(token_amount(&f.svm, &other_merchant_ata), Some(0));
    f.assert_invariants();
}

#[test]
fn settle_delegated_double_settle_is_rejected() {
    let mut f = TFixture::new();
    f.settle(1, 100_000_000).expect("first settle");
    let merchant_after_first = f.token(&f.merchant_ata);

    expect_log(f.settle(1, 100_000_000), "already in use");

    assert_eq!(f.token(&f.merchant_ata), merchant_after_first);
    let r = f.reservation_state().unwrap();
    assert_eq!(r.committed, 100_000_000);
    assert_eq!(r.payments_settled, 1);
}

#[test]
fn settle_delegated_stops_when_the_rent_reserve_runs_out() {
    let mut f = TFixture::with(CAPACITY, PER_PAYMENT_CAP, 1);
    f.settle(1, 10_000_000).expect("first payment uses the only prepaid receipt");
    expect_err(f.settle(2, 10_000_000), "RentReserveExhausted");
    f.assert_invariants();
}

#[test]
fn settle_delegated_is_rejected_at_expiry_with_no_grace_window() {
    let mut f = TFixture::new();

    f.warp_to(f.expires_at - 1);
    f.settle(1, 100_000_000).expect("last second of the spending window");

    f.warp_to(f.expires_at);
    expect_err(f.settle(2, 100_000_000), "ReservationExpired");

    f.warp_to(f.expires_at + 60);
    expect_err(f.settle(3, 100_000_000), "ReservationExpired");

    assert_eq!(f.reservation_state().unwrap().committed, 100_000_000);
    assert!(f.payment_state(2).is_none() && f.payment_state(3).is_none());
}

// ───────────── rail separation ─────────────

#[test]
fn settle_delegated_cannot_touch_a_sol_qr_reservation() {
    let mut f = TFixture::new();
    let owner_pk = pk(&f.owner.pubkey());
    let qr = reservation_pda(&owner_pk, 5);

    let reserve = Instruction {
        program_id: pat::ID,
        accounts: pat::accounts::Reserve {
            owner: owner_pk,
            reservation: qr,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pat::instruction::Reserve {
            reservation_id: 5,
            capacity: CAPACITY,
            per_payment_cap: PER_PAYMENT_CAP,
            expires_at: f.expires_at,
            max_payments: MAX_PAYMENTS,
        }
        .data(),
    };
    let owner = Keypair::try_from(&f.owner.to_bytes()[..]).unwrap();
    send(&mut f.svm, &[reserve], &owner, &[]).expect("QR reserve");
    put_token(&mut f.svm, &ata(&qr, &f.mint), &f.mint, &qr, 500_000_000);

    let ix = settle_delegated_ix(
        &pk(&f.keeper.pubkey()), &qr, MERCHANT_CODE, &f.mint, &f.merchant_ata,
        [5u8; 32], 100_000_000,
    );
    let keeper = Keypair::try_from(&f.keeper.to_bytes()[..]).unwrap();
    // mint == None on a SOL reservation, so the mint constraint rejects it.
    expect_err(send(&mut f.svm, &[ix], &keeper, &[]), "MintMismatch");
}

#[test]
fn sol_withdraw_rejects_a_token_reservation() {
    let mut f = TFixture::new();
    f.warp_to(f.settle_deadline() + 1);
    let owner = Keypair::try_from(&f.owner.to_bytes()[..]).unwrap();
    let keeper = Keypair::try_from(&f.keeper.to_bytes()[..]).unwrap();
    let ix = withdraw_sol_ix(&pk(&owner.pubkey()), &f.reservation);
    expect_err(send(&mut f.svm, &[ix], &keeper, &[&owner]), "TokenReservation");
    assert!(f.reservation_state().is_some());
}

// ───────────── withdraw_token ─────────────

#[test]
fn withdraw_token_is_blocked_until_strictly_after_the_deadline() {
    let mut f = TFixture::new();
    let owner = Keypair::try_from(&f.owner.to_bytes()[..]).unwrap();
    let keeper = Keypair::try_from(&f.keeper.to_bytes()[..]).unwrap();
    let owner_pk = pk(&owner.pubkey());

    for ts in [BASE_TS, f.expires_at, f.settle_deadline()] {
        f.warp_to(ts);
        let ix = withdraw_token_ix(&owner_pk, &f.reservation, &f.mint);
        expect_err(send(&mut f.svm, &[ix], &keeper, &[&owner]), "WithdrawTooEarly");
    }

    f.warp_to(f.settle_deadline() + 1);
    let ix = withdraw_token_ix(&owner_pk, &f.reservation, &f.mint);
    send(&mut f.svm, &[ix], &keeper, &[&owner]).expect("withdraw after the deadline");
    assert!(f.reservation_state().is_none());
}

#[test]
fn withdraw_token_requires_the_owner() {
    let mut f = TFixture::new();
    f.warp_to(f.settle_deadline() + 1);

    let attacker = funded(&mut f.svm);
    let attacker_pk = pk(&attacker.pubkey());
    put_token(&mut f.svm, &ata(&attacker_pk, &f.mint), &f.mint, &attacker_pk, 0);

    let keeper = Keypair::try_from(&f.keeper.to_bytes()[..]).unwrap();
    let ix = withdraw_token_ix(&attacker_pk, &f.reservation, &f.mint);
    expect_err(send(&mut f.svm, &[ix], &keeper, &[&attacker]), "NotReservationOwner");

    assert!(f.reservation_state().is_some());
    assert_eq!(f.token(&f.vault), CAPACITY);
}

#[test]
fn withdraw_token_refunds_only_the_unspent_part_and_closes_everything() {
    let mut f = TFixture::new();
    f.settle(1, 250_000_000).expect("delegated settle");
    f.warp_to(f.settle_deadline() + 1);

    let owner = Keypair::try_from(&f.owner.to_bytes()[..]).unwrap();
    let keeper = Keypair::try_from(&f.keeper.to_bytes()[..]).unwrap();
    let owner_pk = pk(&owner.pubkey());

    let owner_tokens_before = f.token(&f.owner_ata);
    let owner_lamports_before = lamports(&f.svm, &owner_pk);
    let reservation_lamports = lamports(&f.svm, &f.reservation);
    let vault_lamports = lamports(&f.svm, &f.vault);

    let ix = withdraw_token_ix(&owner_pk, &f.reservation, &f.mint);
    // keeper pays the fee so the owner's lamport delta is exact
    let meta = send(&mut f.svm, &[ix], &keeper, &[&owner]).expect("withdraw_token");

    assert_eq!(f.token(&f.owner_ata), owner_tokens_before + (CAPACITY - 250_000_000));
    assert_eq!(f.token(&f.owner_ata), OWNER_TOKENS - 250_000_000);
    assert_eq!(
        lamports(&f.svm, &owner_pk),
        owner_lamports_before + reservation_lamports + vault_lamports
    );
    assert!(token_amount(&f.svm, &f.vault).is_none(), "vault must be closed");
    assert!(f.reservation_state().is_none(), "reservation must be closed");

    let evs = events::<TokenReservationWithdrawn>(&meta.logs);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].mint, f.mint);
    assert_eq!(evs[0].refunded_tokens, CAPACITY - 250_000_000);
    assert_eq!(evs[0].committed, 250_000_000);

    // The merchant keeps proof of payment and keeps the money.
    let p = f.payment_state(1).expect("merchant can still prove the USSD payment");
    assert_eq!(p.rail, PaymentRail::Ussd);
    assert_eq!(p.amount, 250_000_000);
    assert_eq!(f.token(&f.merchant_ata), 250_000_000);
}

// ───────────── merchant registry (unchanged behaviour) ─────────────

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
