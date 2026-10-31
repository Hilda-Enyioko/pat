use anchor_lang::prelude::*;
use anchor_spl::token::{close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::PatError;
use crate::events::TokenReservationWithdrawn;
use crate::state::*;

#[derive(Accounts)]
pub struct WithdrawToken<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// `close = owner` sends the reservation's lamports (rent + unused rent_reserve) to the owner.
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

    #[account(constraint = Some(mint.key()) == reservation.mint @ PatError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = reservation,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw_token(ctx: Context<WithdrawToken>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let (owner, reservation_id, bump) = {
        let r = &ctx.accounts.reservation;
        require!(r.phase(now) == ReservationPhase::Releasable, PatError::WithdrawTooEarly);
        (r.owner, r.reservation_id, r.bump)
    };

    let decimals = ctx.accounts.mint.decimals;
    let refunded_tokens = ctx.accounts.vault.amount;
    let id_bytes = reservation_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[RESERVATION_SEED, owner.as_ref(), &id_bytes, &[bump]]];

    if refunded_tokens > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.reservation.to_account_info(),
                },
                signer_seeds,
            ),
            refunded_tokens,
            decimals,
        )?;
    }

    // Vault is now empty: close it and return its rent to the owner.
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.reservation.to_account_info(),
        },
        signer_seeds,
    ))?;

    let r = &ctx.accounts.reservation;
    emit!(TokenReservationWithdrawn {
        reservation: ctx.accounts.reservation.key(),
        owner,
        mint: ctx.accounts.mint.key(),
        reservation_id,
        capacity: r.capacity,
        committed: r.committed,
        payments_settled: r.payments_settled,
        refunded_tokens,
        refunded_lamports: ctx.accounts.reservation.to_account_info().lamports(),
        withdrawn_at: now,
    });

    Ok(())
}
