use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod ed25519;

pub use constants::*;
pub use state::*;
pub use error::*;
pub use instructions::*;

declare_id!("HopC7DPpeyiPiq2Nqyy9WDCRBKduNu3PoqyaN6ACZUhh");

#[program]
pub mod pat {
    use super::*;

    pub fn reserve(
        ctx: Context<Reserve>,
        reservation_id: u64,
        capacity: u64,
        per_payment_cap: u64,
        expires_at: i64,
        max_payments: u32,
    ) -> Result<()> {
        instructions::reserve::handle_reserve(
            ctx,
            reservation_id,
            capacity,
            per_payment_cap,
            expires_at,
            max_payments,
        )
    }

    pub fn settle(ctx: Context<Settle>, intent: PaymentIntent) -> Result<()> {
        instructions::settle::handle_settle(ctx, intent)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx)
    }

}
