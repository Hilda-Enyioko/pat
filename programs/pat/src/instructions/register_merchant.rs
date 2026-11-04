use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PatError;
use crate::events::MerchantRegistered;
use crate::state::*;

#[derive(Accounts)]
#[instruction(code: u32)]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PatError::NotAdmin,
    )]
    pub config: Account<'info, Config>,

    /// `init` means a code can be registered once and never overwritten.
    #[account(
        init,
        payer = admin,
        space = Merchant::SPACE,
        seeds = [MERCHANT_SEED, &code.to_le_bytes()],
        bump,
    )]
    pub merchant_entry: Account<'info, Merchant>,

    pub system_program: Program<'info, System>,
}

pub fn handle_register_merchant(
    ctx: Context<RegisterMerchant>,
    code: u32,
    payout: Pubkey,
) -> Result<()> {
    require!(code > 0, PatError::InvalidMerchantCode);

    let m = &mut ctx.accounts.merchant_entry;
    m.code = code;
    m.payout = payout;
    m.bump = ctx.bumps.merchant_entry;

    emit!(MerchantRegistered {
        code,
        payout,
        admin: ctx.accounts.admin.key(),
    });
    Ok(())
}
