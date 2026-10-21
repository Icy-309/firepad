//! Holder rewards: cumulative merkle distributor.
//!
//! Off-chain, the keeper samples every wallet's balance through each epoch, splits
//! the new holder SOL pro rata by balance × time (so buying right before a snapshot
//! earns almost nothing), and publishes a root over (wallet, cumulative_lamports).
//! On-chain guarantees, whatever the keeper does:
//!   - roots are only published by the keeper, one epoch at a time;
//!   - the committed total never decreases and never exceeds the SOL actually
//!     credited to holders (`holder_fees_total`);
//!   - total claims never exceed the committed total.
//! So the keeper can misallocate between holders, but can never take holder SOL.
//!
//! Leaf = sha256(0x00 ‖ wallet ‖ cumulative_u64_le); node = sha256(0x01 ‖ min ‖ max).

use super::vault_pay;
use crate::errors::FirepadError;
use crate::state::{ClaimStatus, Config, TokenState};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

pub const MAX_PROOF_LEN: usize = 32;

#[derive(Accounts)]
pub struct SetRewardsRoot<'info> {
    pub keeper: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump, has_one = keeper @ FirepadError::NotKeeper)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"token", token_state.mint.as_ref()], bump = token_state.bump)]
    pub token_state: Account<'info, TokenState>,
}

pub fn set_rewards_root(ctx: Context<SetRewardsRoot>, root: [u8; 32], total: u64, epoch: u32) -> Result<()> {
    let ts = &mut ctx.accounts.token_state;
    require!(
        epoch == ts.rewards_epoch.checked_add(1).ok_or(FirepadError::MathOverflow)?
            && total >= ts.rewards_root_total
            && total <= ts.holder_fees_total,
        FirepadError::BadRewardsRoot
    );
    ts.rewards_root = root;
    ts.rewards_root_total = total;
    ts.rewards_epoch = epoch;
    msg!("REWARDS epoch {} total {}", epoch, total);
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [b"token", token_state.mint.as_ref()], bump = token_state.bump)]
    pub token_state: Account<'info, TokenState>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + ClaimStatus::INIT_SPACE,
        seeds = [b"claim", token_state.mint.as_ref(), owner.key().as_ref()],
        bump
    )]
    pub claim_status: Account<'info, ClaimStatus>,

    #[account(mut, seeds = [b"reward_vault", token_state.mint.as_ref()], bump = token_state.reward_vault_bump)]
    pub reward_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn claim_rewards(ctx: Context<ClaimRewards>, cumulative: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    require!(proof.len() <= MAX_PROOF_LEN, FirepadError::InvalidProof);
    let owner = ctx.accounts.owner.key();
    let ts = &mut ctx.accounts.token_state;

    let mut node = hashv(&[&[0u8], owner.as_ref(), &cumulative.to_le_bytes()]).to_bytes();
    for sibling in proof.iter() {
        node = if node <= *sibling {
            hashv(&[&[1u8], &node, sibling])
        } else {
            hashv(&[&[1u8], sibling, &node])
        }
        .to_bytes();
    }
    require!(node == ts.rewards_root, FirepadError::InvalidProof);

    let status = &mut ctx.accounts.claim_status;
    status.bump = ctx.bumps.claim_status;
    let amount = cumulative.saturating_sub(status.claimed);
    require!(amount > 0, FirepadError::NothingToClaim);

    let claimed_total = ts.holder_claimed_total.checked_add(amount).ok_or(FirepadError::MathOverflow)?;
    require!(claimed_total <= ts.rewards_root_total, FirepadError::BadRewardsRoot);
    ts.holder_claimed_total = claimed_total;
    status.claimed = cumulative;

    let mint_key = ts.mint;
    let bump = ts.reward_vault_bump;
    vault_pay(
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.reward_vault.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &[b"reward_vault", mint_key.as_ref(), &[bump]],
        amount,
    )?;
    msg!("Holder {} claimed {} lamports", owner, amount);
    Ok(())
}
