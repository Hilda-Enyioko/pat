use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::PatError;
use crate::events::PaymentSettled;
use crate::instructions::settle::credit;
use crate::state::*;

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct SettleDelegated<'info> {
    /// The reservation's delegate (keeper key). Fronts Payment rent, reimbursed from rent_reserve.
    #[account(mut)]
    pub delegate: Signer<'info>,

    #[account(
        mut,
        seeds = [
            RESERVATION_SEED,
            reservation.owner.as_ref(),
            &reservation.reservation_id.to_le_bytes()
        ],
        bump = reservation.bump,
    )]
    pub reservation: Account<'info, Reservation>,

    #[account(
        seeds = [MERCHANT_SEED, &merchant_entry.code.to_le_bytes()],
        bump = merchant_entry.bump,
    )]
    pub merchant_entry: Account<'info, Merchant>,

    /// Must be the mint this reservation was funded with. A SOL (QR) reservation has
    /// `mint == None`, so it can never be settled through this instruction.
    #[account(constraint = Some(mint.key()) == reservation.mint @ PatError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    /// Escrow: the reservation PDA's associated token account.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = reservation,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Tokens can only go to a token account owned by the registered payout address.
    #[account(
        mut,
        token::mint = mint,
        constraint = merchant_token_account.owner == merchant_entry.payout @ PatError::MerchantMismatch,
    )]
    pub merchant_token_account: Account<'info, TokenAccount>,

    /// Same replay guard as `settle`: a second settle with this payment_id fails at `init`.
    #[account(
        init,
        payer = delegate,
        space = Payment::SPACE,
        seeds = [PAYMENT_SEED, reservation.key().as_ref(), payment_id.as_ref()],
        bump,
    )]
    pub payment: Account<'info, Payment>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_settle_delegated(
    ctx: Context<SettleDelegated>,
    payment_id: [u8; 32],
    amount: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let reservation_key = ctx.accounts.reservation.key();
    let delegate_key = ctx.accounts.delegate.key();
    let mint_key = ctx.accounts.mint.key();
    let decimals = ctx.accounts.mint.decimals;
    let merchant_owner = ctx.accounts.merchant_entry.payout;

    // Rail, signer, window, per-payment cap, capacity.
    let (sequence, owner, reservation_id, bump) = {
        let r = &ctx.accounts.reservation;
        let expected = r.delegate.ok_or(error!(PatError::ReservationNotDelegated))?;
        require_keys_eq!(expected, delegate_key, PatError::NotDelegate);
        // No offline intent on this rail: payments must be live, inside the spending
        // window. The grace period exists for offline intents and doesn't apply here.
        require!(now < r.expires_at, PatError::ReservationExpired);
        r.check_can_settle(amount, now)?;
        (r.payments_settled, r.owner, r.reservation_id, r.bump)
    };

    let rent = Rent::get()?;
    let payment_rent = rent.minimum_balance(Payment::SPACE);

    {
        let r = &mut ctx.accounts.reservation;
        require!(r.rent_reserve >= payment_rent, PatError::RentReserveExhausted);
        r.commit(amount)?;
        r.rent_reserve -= payment_rent;
    }

    {
        let p = &mut ctx.accounts.payment;
        p.payment_id = payment_id;
        p.reservation = reservation_key;
        p.payer = owner;
        p.merchant = merchant_owner;
        p.amount = amount;
        p.status = PaymentStatus::Settled;
        p.intent_created_at = now; // no intent on this rail
        p.settled_at = now;
        p.settled_slot = clock.slot;
        p.sequence = sequence;
        p.rail = PaymentRail::Ussd;
        p.mint = Some(mint_key);
        p.bump = ctx.bumps.payment;
    }

    // Tokens: vault -> merchant, signed by the reservation PDA.
    let id_bytes = reservation_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[RESERVATION_SEED, owner.as_ref(), &id_bytes, &[bump]]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.merchant_token_account.to_account_info(),
                authority: ctx.accounts.reservation.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )?;

    // Lamports: reimburse the delegate for the Payment rent it fronted.
    let reservation_info = ctx.accounts.reservation.to_account_info();
    {
        let mut lamports = reservation_info.try_borrow_mut_lamports()?;
        **lamports = (**lamports)
            .checked_sub(payment_rent)
            .ok_or(error!(PatError::Overflow))?;
    }
    credit(&ctx.accounts.delegate.to_account_info(), payment_rent)?;

    // Invariants: tokens in the vault cover what is uncommitted; lamports cover rent + rent_reserve.
    ctx.accounts.vault.reload()?;
    let r = &ctx.accounts.reservation;
    require!(
        ctx.accounts.vault.amount >= r.capacity - r.committed,
        PatError::TokenInvariantBroken
    );
    let required = rent
        .minimum_balance(Reservation::SPACE)
        .checked_add(r.rent_reserve)
        .ok_or(error!(PatError::Overflow))?;
    require!(
        reservation_info.lamports() >= required,
        PatError::LamportInvariantBroken
    );

    emit!(PaymentSettled {
        reservation: reservation_key,
        payment: ctx.accounts.payment.key(),
        payment_id,
        payer: owner,
        merchant: merchant_owner,
        settler: delegate_key,
        amount,
        sequence,
        intent_created_at: now,
        settled_at: now,
        settled_slot: clock.slot,
        committed_total: r.committed,
        payments_settled: r.payments_settled,
        rail: PaymentRail::Ussd,
        mint: Some(mint_key),
    });

    Ok(())
}
