use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::PatError;
use crate::events::ReservationCreated;
use crate::state::*;

#[derive(Accounts)]
#[instruction(reservation_id: u64)]
pub struct ReserveDelegated<'info> {
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

    pub mint: Account<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token_account: Account<'info, TokenAccount>,

    /// Escrow: the reservation PDA's associated token account.
    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = reservation,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_reserve_delegated(
    ctx: Context<ReserveDelegated>,
    reservation_id: u64,
    capacity: u64,
    per_payment_cap: u64,
    expires_at: i64,
    max_payments: u32,
    delegate: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let owner_key = ctx.accounts.owner.key();
    let mint_key = ctx.accounts.mint.key();
    let decimals = ctx.accounts.mint.decimals;

    Reservation::validate_delegate(&delegate, &owner_key)?;
    Reservation::validate_params(capacity, per_payment_cap, expires_at, max_payments, now)?;
    let settle_deadline = Reservation::deadline_for(expires_at)?;

    let rent = Rent::get()?;
    let rent_reserve =
        Reservation::rent_reserve_for(max_payments, rent.minimum_balance(Payment::SPACE))?;

    {
        let r = &mut ctx.accounts.reservation;
        r.owner = owner_key;
        r.reservation_id = reservation_id;
        r.capacity = capacity;
        r.committed = 0;
        r.rent_reserve = rent_reserve;
        r.per_payment_cap = per_payment_cap;
        r.payments_settled = 0;
        r.created_at = now;
        r.expires_at = expires_at;
        r.settle_deadline = settle_deadline;
        r.delegate = Some(delegate);
        r.mint = Some(mint_key);
        r.bump = ctx.bumps.reservation;
    }

    // Lamports for Payment rent (reimbursed to the delegate as it fronts them).
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.reservation.to_account_info(),
            },
        ),
        rent_reserve,
    )?;

    // Capacity: owner's tokens -> vault.
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.owner_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        capacity,
        decimals,
    )?;

    ctx.accounts.vault.reload()?;
    require!(ctx.accounts.vault.amount >= capacity, PatError::TokenInvariantBroken);

    let required = rent
        .minimum_balance(Reservation::SPACE)
        .checked_add(rent_reserve)
        .ok_or(error!(PatError::Overflow))?;
    require!(
        ctx.accounts.reservation.to_account_info().lamports() >= required,
        PatError::LamportInvariantBroken
    );

    emit!(ReservationCreated {
        reservation: ctx.accounts.reservation.key(),
        owner: owner_key,
        reservation_id,
        capacity,
        per_payment_cap,
        rent_reserve,
        max_payments,
        created_at: now,
        expires_at,
        settle_deadline,
        delegate: Some(delegate),
        mint: Some(mint_key),
    });

    Ok(())
}
