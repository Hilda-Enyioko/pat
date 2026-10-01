use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::*;
use crate::error::PatError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(reservation_id: u64)]
pub struct Reserve<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = Reservation::SPACE,
        seeds = [RESERVATION_SEED, owner.key().as_ref(), &reservation_id.to_le_bytes()],
        bump,
    )]
    pub reservation: Account<'info, Reservation>,

    pub system_program: Program<'info, System>,
}

pub fn handle_reserve(
    ctx: Context<Reserve>,
    reservation_id: u64,
    capacity: u64,
    per_payment_cap: u64,
    expires_at: i64,
    max_payments: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    Reservation::validate_params(capacity, per_payment_cap, expires_at, max_payments, now)?;
    let settle_deadline = Reservation::deadline_for(expires_at)?;

    let rent = Rent::get()?;
    let rent_reserve =
        Reservation::rent_reserve_for(max_payments, rent.minimum_balance(Payment::SPACE))?;
    let deposit = capacity
        .checked_add(rent_reserve)
        .ok_or(error!(PatError::Overflow))?;

    // Write state first (the borrow of `r` ends before the CPI below).
    {
        let r = &mut ctx.accounts.reservation;
        r.owner = ctx.accounts.owner.key();
        r.reservation_id = reservation_id;
        r.capacity = capacity;
        r.committed = 0;
        r.rent_reserve = rent_reserve;
        r.per_payment_cap = per_payment_cap;
        r.payments_settled = 0;
        r.created_at = now;
        r.expires_at = expires_at;
        r.settle_deadline = settle_deadline;
        r.bump = ctx.bumps.reservation;
    }

    // Lock funds: owner -> reservation account (the escrow itself).
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.reservation.to_account_info(),
            },
        ),
        deposit,
    )?;

    // Lamport invariant (section 3.4), equality expected at creation.
    let required = rent
        .minimum_balance(Reservation::SPACE)
        .checked_add(capacity)
        .and_then(|v| v.checked_add(rent_reserve))
        .ok_or(error!(PatError::Overflow))?;
    require!(
        ctx.accounts.reservation.to_account_info().lamports() >= required,
        PatError::LamportInvariantBroken
    );

    Ok(())
}
