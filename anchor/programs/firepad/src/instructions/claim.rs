use super::vault_pay;
use crate::errors::FirepadError;
use crate::state::TokenState;
use anchor_lang::prelude::*;

// Holder claims live in rewards.rs (merkle distributor).

// ---------------------------------------------------------------------------
// claim_creator_fees: creator withdraws their 50% of the swapped fees.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimCreatorFees<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"token", token_state.mint.as_ref()],
        bump = token_state.bump,
        has_one = creator @ FirepadError::NotCreator,
    )]
    pub token_state: Account<'info, TokenState>,

    #[account(mut, seeds = [b"creator_vault", token_state.mint.as_ref()], bump = token_state.creator_vault_bump)]
    pub creator_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
    let ts = &mut ctx.accounts.token_state;
    let amount = ts.creator_fees_owed;
    require!(amount > 0, FirepadError::NothingToClaim);
    ts.creator_fees_owed = 0;

    let mint_key = ts.mint;
    let bump = ts.creator_vault_bump;
    vault_pay(
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.creator_vault.to_account_info(),
        &ctx.accounts.creator.to_account_info(),
        &[b"creator_vault", mint_key.as_ref(), &[bump]],
        amount,
    )?;

    msg!("Creator claimed {} lamports", amount);
    Ok(())
}
