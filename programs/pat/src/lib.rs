use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use state::*;
pub use error::*;
pub use instructions::*;

declare_id!("HpSkCuHays9S7gAVs45BcU6t2gjjeE6dEdy3TwyqcwB8");

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
}
