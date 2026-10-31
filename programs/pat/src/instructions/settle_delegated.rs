use anchor_lang::prelude::*;

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

    /// Funds can only go to the payout address in the registry.
    #[account(mut, address = merchant_entry.payout @ PatError::MerchantMismatch)]
    pub merchant: SystemAccount<'info>,

    /// Same replay guard as `settle`: a second settle with this payment_id fails at `init`.
    #[account(
        init,
        payer = delegate,
        space = Payment::SPACE,
        seeds = [PAYMENT_SEED, reservation.key().as_ref(), payment_id.as_ref()],
        bump,
    )]
    pub payment: Account<'info, Payment>,

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
    let merchant_key = ctx.accounts.merchant.key();

    // Rail, signer, window, per-payment cap, capacity.
    let sequence = {
        let r = &ctx.accounts.reservation;
        let expected = r.delegate.ok_or(error!(PatError::ReservationNotDelegated))?;
        require_keys_eq!(expected, delegate_key, PatError::NotDelegate);
        // No offline intent on this rail: payments must be live, inside the spending
        // window. The grace period exists for offline intents and doesn't apply here.
        require!(now < r.expires_at, PatError::ReservationExpired);
        r.check_can_settle(amount, now)?;
        r.payments_settled
    };

    let rent = Rent::get()?;
    let payment_rent = rent.minimum_balance(Payment::SPACE);

    let payer = {
        let r = &mut ctx.accounts.reservation;
        require!(r.rent_reserve >= payment_rent, PatError::RentReserveExhausted);
        r.commit(amount)?;
        r.rent_reserve -= payment_rent;
        r.owner
    };

    {
        let p = &mut ctx.accounts.payment;
        p.payment_id = payment_id;
        p.reservation = reservation_key;
        p.payer = payer;
        p.merchant = merchant_key;
        p.amount = amount;
        p.status = PaymentStatus::Settled;
        p.intent_created_at = now; // no intent on this rail
        p.settled_at = now;
        p.settled_slot = clock.slot;
        p.sequence = sequence;
        p.rail = PaymentRail::Ussd;
        p.bump = ctx.bumps.payment;
    }

    let payout = amount
        .checked_add(payment_rent)
        .ok_or(error!(PatError::Overflow))?;
    let reservation_info = ctx.accounts.reservation.to_account_info();
    {
        let mut lamports = reservation_info.try_borrow_mut_lamports()?;
        **lamports = (**lamports)
            .checked_sub(payout)
            .ok_or(error!(PatError::Overflow))?;
    }
    credit(&ctx.accounts.merchant.to_account_info(), amount)?;
    credit(&ctx.accounts.delegate.to_account_info(), payment_rent)?;

    let r = &ctx.accounts.reservation;
    let required = rent
        .minimum_balance(Reservation::SPACE)
        .checked_add(r.capacity - r.committed)
        .and_then(|v| v.checked_add(r.rent_reserve))
        .ok_or(error!(PatError::Overflow))?;
    require!(
        reservation_info.lamports() >= required,
        PatError::LamportInvariantBroken
    );

    emit!(PaymentSettled {
        reservation: reservation_key,
        payment: ctx.accounts.payment.key(),
        payment_id,
        payer,
        merchant: merchant_key,
        settler: delegate_key,
        amount,
        sequence,
        intent_created_at: now,
        settled_at: now,
        settled_slot: clock.slot,
        committed_total: r.committed,
        payments_settled: r.payments_settled,
        rail: PaymentRail::Ussd,
    });

    Ok(())
}
