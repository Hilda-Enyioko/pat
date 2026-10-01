use anchor_lang::prelude::*;

use crate::constants::*;
use crate::ed25519::verify_ed25519_intent;
use crate::error::PatError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(intent: PaymentIntent)]
pub struct Settle<'info> {
    /// Anyone (merchant or relayer). Fronts the Payment rent, reimbursed from rent_reserve.
    #[account(mut)]
    pub settler: Signer<'info>,

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

    /// Funds can only ever go to the merchant named in the signed intent.
    #[account(mut, address = intent.merchant @ PatError::MerchantMismatch)]
    pub merchant: SystemAccount<'info>,

    /// Existence of this PDA == CONFIRMED, and the replay guard:
    /// a second settle with the same payment_id fails at `init`.
    #[account(
        init,
        payer = settler,
        space = Payment::SPACE,
        seeds = [PAYMENT_SEED, reservation.key().as_ref(), intent.payment_id.as_ref()],
        bump,
    )]
    pub payment: Account<'info, Payment>,

    /// CHECK: pinned to the real instructions sysvar address. Without this, an attacker
    /// could pass a forged account that pretends to contain a valid ed25519 instruction.
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

fn credit(info: &AccountInfo, amount: u64) -> Result<()> {
    let mut lamports = info.try_borrow_mut_lamports()?;
    **lamports = (**lamports)
        .checked_add(amount)
        .ok_or(error!(PatError::Overflow))?;
    Ok(())
}

pub fn handle_settle(ctx: Context<Settle>, intent: PaymentIntent) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let reservation_key = ctx.accounts.reservation.key();

    // Checks 1 and 2: ed25519 precompile verified `intent.payer` over the exact bytes.
    verify_ed25519_intent(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &intent.payer,
        &intent.signing_bytes(),
    )?;

    // Checks 3, 6, 7 (check 4 is the Payment seeds, check 5 is `init`).
    {
        let r = &ctx.accounts.reservation;
        intent.check_binding(&reservation_key, r)?; // payer == owner, reservation key
        intent.validate_window(r)?; // version, cluster, windows, ledger claim
        // An intent cannot predate the reservation it spends from. This blocks a stale
        // intent from being settled against a re-created reservation at the same address.
        require!(intent.created_at >= r.created_at, PatError::InvalidIntentWindow);
        r.check_can_settle(intent.amount, now)?; // deadline, per-payment cap, capacity
    }

    let rent = Rent::get()?;
    let payment_rent = rent.minimum_balance(Payment::SPACE);

    // Update reservation accounting.
    {
        let r = &mut ctx.accounts.reservation;
        require!(r.rent_reserve >= payment_rent, PatError::RentReserveExhausted);
        r.commit(intent.amount)?;
        r.rent_reserve -= payment_rent; // safe: checked just above
    }

    // Write the Payment record.
    {
        let p = &mut ctx.accounts.payment;
        p.payment_id = intent.payment_id;
        p.reservation = reservation_key;
        p.payer = intent.payer;
        p.merchant = intent.merchant;
        p.amount = intent.amount;
        p.status = PaymentStatus::Settled;
        p.intent_created_at = intent.created_at;
        p.settled_at = now;
        p.settled_slot = clock.slot;
        p.sequence = intent.sequence;
        p.bump = ctx.bumps.payment;
    }

    // Move lamports. The program owns the reservation, so it can debit it directly.
    let payout = intent
        .amount
        .checked_add(payment_rent)
        .ok_or(error!(PatError::Overflow))?;
    let reservation_info = ctx.accounts.reservation.to_account_info();
    {
        let mut lamports = reservation_info.try_borrow_mut_lamports()?;
        **lamports = (**lamports)
            .checked_sub(payout)
            .ok_or(error!(PatError::Overflow))?;
    }
    credit(&ctx.accounts.merchant.to_account_info(), intent.amount)?;
    // Reimburse whoever fronted the Payment rent (this is "payer pays rent").
    credit(&ctx.accounts.settler.to_account_info(), payment_rent)?;

    // Lamport invariant (section 3.4), equality expected after every settle.
    let r = &ctx.accounts.reservation;
    let required = rent
        .minimum_balance(Reservation::SPACE)
        .checked_add(r.capacity - r.committed) // committed <= capacity by commit()
        .and_then(|v| v.checked_add(r.rent_reserve))
        .ok_or(error!(PatError::Overflow))?;
    require!(
        reservation_info.lamports() >= required,
        PatError::LamportInvariantBroken
    );

    Ok(())
}
