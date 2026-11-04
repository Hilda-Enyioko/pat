use anchor_lang::prelude::*;
use crate::state::PaymentRail;

#[event]
pub struct ReservationCreated {
    pub reservation: Pubkey,
    pub owner: Pubkey,
    pub reservation_id: u64,
    pub capacity: u64,
    pub per_payment_cap: u64,
    pub rent_reserve: u64,
    pub max_payments: u32,
    pub created_at: i64,
    pub expires_at: i64,
    pub settle_deadline: i64,
    pub delegate: Option<Pubkey>,
    pub mint: Option<Pubkey>,
}

#[event]
pub struct PaymentSettled {
    pub reservation: Pubkey,
    pub payment: Pubkey,
    pub payment_id: [u8; 32],
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub settler: Pubkey,
    pub amount: u64,
    pub sequence: u32,
    pub intent_created_at: i64,
    pub settled_at: i64,
    pub settled_slot: u64,
    pub committed_total: u64,
    pub payments_settled: u32,
    pub rail: PaymentRail,
    pub mint: Option<Pubkey>,
}

#[event]
pub struct ReservationWithdrawn {
    pub reservation: Pubkey,
    pub owner: Pubkey,
    pub reservation_id: u64,
    pub capacity: u64,
    pub committed: u64,
    pub payments_settled: u32,
    pub unused_capacity: u64,
    pub unused_rent_reserve: u64,
    pub refunded_lamports: u64,
    pub withdrawn_at: i64,
}

#[event]
pub struct MerchantRegistered {
    pub code: u32,
    pub payout: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct TokenReservationWithdrawn {
    pub reservation: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub reservation_id: u64,
    pub capacity: u64,
    pub committed: u64,
    pub payments_settled: u32,
    pub refunded_tokens: u64,
    pub refunded_lamports: u64,
    pub withdrawn_at: i64,
}
