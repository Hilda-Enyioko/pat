use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod ed25519;
pub mod events;

pub use constants::*;
pub use state::*;
pub use error::*;
pub use instructions::*;
pub use events::*;

declare_id!("FZZBN6jwVzWMKR67rta8MewDZPqG8mRHP5igK6qwN8fT");

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

        pub fn reserve_delegated(
        ctx: Context<Reserve>,
        reservation_id: u64,
        capacity: u64,
        per_payment_cap: u64,
        expires_at: i64,
        max_payments: u32,
        delegate: Pubkey,
    ) -> Result<()> {
        instructions::reserve::handle_reserve_delegated(
            ctx, reservation_id, capacity, per_payment_cap, expires_at, max_payments, delegate,
        )
    }

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        instructions::init_config::handle_init_config(ctx)
    }

    pub fn register_merchant(ctx: Context<RegisterMerchant>, code: u32, payout: Pubkey) -> Result<()> {
        instructions::register_merchant::handle_register_merchant(ctx, code, payout)
    }

    pub fn settle_delegated(
        ctx: Context<SettleDelegated>,
        payment_id: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        instructions::settle_delegated::handle_settle_delegated(ctx, payment_id, amount)
    }

}
