use crate::errors::FirepadError;
use crate::state::{Config, CurveParams};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ FirepadError::NotAuthority,
    )]
    pub config: Account<'info, Config>,
}

/// Admin-only. Every field is optional; `None` keeps the current value.
/// The 50/50 creator/holder split is hardcoded and cannot be changed here.
/// Fee and curve changes only affect tokens launched afterwards — each mint's
/// transfer fee is fixed forever at launch.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateConfigParams {
    pub fee_bps: Option<u16>,
    pub curve: Option<CurveParams>,
    pub new_authority: Option<Pubkey>,
    pub new_keeper: Option<Pubkey>,
}

pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(fee) = params.fee_bps {
        require!(fee <= 1000, FirepadError::FeeTooHigh);
        config.fee_bps = fee;
    }
    if let Some(curve) = params.curve {
        curve.validate()?;
        config.curve = curve;
    }
    if let Some(k) = params.new_keeper {
        msg!("Keeper {} -> {}", config.keeper, k);
        config.keeper = k;
    }
    if let Some(a) = params.new_authority {
        msg!("Config authority {} -> {}", config.authority, a);
        config.authority = a;
    }

    msg!("Config updated: fee={}bps (new launches)", config.fee_bps);
    Ok(())
}
