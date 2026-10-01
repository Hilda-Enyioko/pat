use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PatError;
use crate::state::*;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// Must be the reservation owner. Receives everything left in the account.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// `close = owner` runs only if the handler returns Ok. It zeroes the data,
    /// assigns the account to the system program and sends ALL lamports to `owner`:
    /// unused capacity + unused rent_reserve + the account's own rent.
    #[account(
        mut,
        close = owner,
        has_one = owner @ PatError::NotReservationOwner,
        seeds = [
            RESERVATION_SEED,
            reservation.owner.as_ref(),
            &reservation.reservation_id.to_le_bytes()
        ],
        bump = reservation.bump,
    )]
    pub reservation: Account<'info, Reservation>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let r = &ctx.accounts.reservation;

    // Funds stay locked until strictly after settle_deadline. There is no early close,
    // so an offline merchant always has the full grace window to reconnect and settle.
    require!(
        r.phase(now) == ReservationPhase::Releasable,
        PatError::WithdrawTooEarly
    );

    // Sanity check of the lamport invariant (section 3.4) before the refund.
    let rent = Rent::get()?;
    let required = rent
        .minimum_balance(Reservation::SPACE)
        .checked_add(r.remaining())
        .and_then(|v| v.checked_add(r.rent_reserve))
        .ok_or(error!(PatError::Overflow))?;
    require!(
        ctx.accounts.reservation.to_account_info().lamports() >= required,
        PatError::LamportInvariantBroken
    );

    Ok(())
}
