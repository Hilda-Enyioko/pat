use anchor_lang::prelude::*;

#[constant]
pub const COUNTER_SEED: &[u8] = b"counter";

#[constant]
pub const HELLO_WORLD_LAMPORTS: u64 = 1;

#[constant]
pub const MAX_COUNT: u64 = 10;

pub const RESERVATION_SEED: &[u8] = b"reservation";
pub const PAYMENT_SEED: &[u8] = b"payment";

/// 0 = localnet, 1 = devnet, 2 = mainnet-beta.
/// Later: drive this from a cargo feature so one binary can't be built with the wrong value.
pub const CLUSTER_ID: u8 = 1;

/// Domain separator prepended to the signed intent bytes (13 bytes).
pub const INTENT_DOMAIN: &[u8] = b"PAT-INTENT-v1";
pub const INTENT_VERSION: u8 = 1;

/// Time after `expires_at` during which accepted intents can still settle.
pub const SETTLE_GRACE_SECS: i64 = 30 * 60;

// Prototype guard: bounds the rent_reserve a single reservation can demand.
pub const MAX_PAYMENTS_PER_RESERVATION: u32 = 1_000;