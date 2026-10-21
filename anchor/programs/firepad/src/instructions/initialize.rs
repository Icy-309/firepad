use crate::errors::FirepadError;
use crate::state::{Config, CurveParams};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

/// Pass `CurveParams::PUMP_FUN` values for pump.fun-identical launches.
/// `fee_bps` is the token transfer fee for new launches; `keeper` runs fee
/// collection/swaps and publishes holder-reward roots.
pub fn initialize(ctx: Context<Initialize>, fee_bps: u16, keeper: Pubkey, curve: CurveParams) -> Result<()> {
    require!(fee_bps <= 1000, FirepadError::FeeTooHigh);
    curve.validate()?;

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.keeper = keeper;
    config.fee_bps = fee_bps;
    config.curve = curve;
    config.bump = ctx.bumps.config;

    msg!("firepad initialized: {}bps token fee, split 50/50 creator/holders", fee_bps);
    Ok(())
}
