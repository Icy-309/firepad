//! Fee pipeline. Every transfer withholds `fee_bps` of the tokens (Token-2022
//! transfer fee). Fees are turned into SOL and split strictly 50/50:
//!
//!   1. anyone: `harvest_withheld_tokens_to_mint` (plain Token-2022 instruction,
//!      permissionless) sweeps withheld fees from token accounts into the mint;
//!   2. anyone: `collect_fees` withdraws them from the mint into the curve vault;
//!        - before graduation: sells them into the curve right here (atomic, no DEX,
//!          can't be front-run) and splits the SOL;
//!        - after graduation: parks them as `pending_fee_tokens`;
//!   3. keeper (after graduation): `take_fee_tokens` → swap on a DEX off-chain →
//!      `deposit_swapped_fees`, which splits the SOL. Counters on TokenState make
//!      the keeper's swap rate auditable against market prices.

use super::vault_pay;
use crate::curve::{sol_out_for_tokens_in, split_fee};
use crate::errors::FirepadError;
use crate::state::{Config, TokenState};
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer as sys_transfer, Transfer as SysTransfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::instruction::withdraw_withheld_tokens_from_mint;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

// ---------------------------------------------------------------------------
// collect_fees (permissionless)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CollectFees<'info> {
    /// Anyone (the keeper bot in practice). Pays only the tx fee.
    pub caller: Signer<'info>,

    #[account(mut, seeds = [b"token", mint.key().as_ref()], bump = token_state.bump)]
    pub token_state: Account<'info, TokenState>,

    /// Harvested fees sit in the mint's withheld balance.
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = token_state,
        associated_token::token_program = token_program,
    )]
    pub curve_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [b"sol_vault", mint.key().as_ref()], bump = token_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"creator_vault", mint.key().as_ref()], bump = token_state.creator_vault_bump)]
    pub creator_vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"reward_vault", mint.key().as_ref()], bump = token_state.reward_vault_bump)]
    pub reward_vault: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
    let mint_key = ctx.accounts.token_state.mint;
    let ts_bump = ctx.accounts.token_state.bump;

    // Withdraw everything harvested into the mint → curve vault (token_state is the
    // withdraw-withheld authority). Moving withheld fees charges no new fee.
    let before = ctx.accounts.curve_vault.amount;
    let ix = withdraw_withheld_tokens_from_mint(
        &ctx.accounts.token_program.key(),
        &mint_key,
        &ctx.accounts.curve_vault.key(),
        &ctx.accounts.token_state.key(),
        &[],
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.curve_vault.to_account_info(),
            ctx.accounts.token_state.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        &[&[b"token", mint_key.as_ref(), &[ts_bump]]],
    )?;
    ctx.accounts.curve_vault.reload()?;
    let collected = ctx
        .accounts
        .curve_vault
        .amount
        .checked_sub(before)
        .ok_or(FirepadError::MathOverflow)?;
    require!(collected > 0, FirepadError::NothingToCollect);

    let ts = &mut ctx.accounts.token_state;
    if ts.complete {
        ts.pending_fee_tokens = ts.pending_fee_tokens.checked_add(collected).ok_or(FirepadError::MathOverflow)?;
        msg!("FEES {} tokens pending swap", collected);
        return Ok(());
    }

    // Sell the fee tokens into the curve. They came out of circulation, so the curve
    // can always pay for them; the min() only guards against rounding at the edges.
    let sol = sol_out_for_tokens_in(ts.virtual_sol_reserves, ts.virtual_token_reserves, collected)?
        .min(ts.real_sol_reserves);
    ts.virtual_token_reserves = ts.virtual_token_reserves.checked_add(collected).ok_or(FirepadError::MathOverflow)?;
    ts.virtual_sol_reserves = ts.virtual_sol_reserves.checked_sub(sol).ok_or(FirepadError::MathOverflow)?;
    ts.real_token_reserves = ts.real_token_reserves.checked_add(collected).ok_or(FirepadError::MathOverflow)?;
    ts.real_sol_reserves = ts.real_sol_reserves.checked_sub(sol).ok_or(FirepadError::MathOverflow)?;

    let (creator, holders) = split_fee(sol)?;
    ts.credit_fees(creator, holders)?;
    let vault_bump = ts.sol_vault_bump;

    let sys = ctx.accounts.system_program.to_account_info();
    let vault = ctx.accounts.sol_vault.to_account_info();
    let seeds: &[&[u8]] = &[b"sol_vault", mint_key.as_ref(), &[vault_bump]];
    vault_pay(&sys, &vault, &ctx.accounts.creator_vault.to_account_info(), seeds, creator)?;
    vault_pay(&sys, &vault, &ctx.accounts.reward_vault.to_account_info(), seeds, holders)?;

    msg!("FEES {} tokens -> {} SOL (creator {} / holders {})", collected, sol, creator, holders);
    Ok(())
}

// ---------------------------------------------------------------------------
// take_fee_tokens / deposit_swapped_fees (keeper, after graduation)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct TakeFeeTokens<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump, has_one = keeper @ FirepadError::NotKeeper)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"token", mint.key().as_ref()], bump = token_state.bump)]
    pub token_state: Account<'info, TokenState>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = token_state,
        associated_token::token_program = token_program,
    )]
    pub curve_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = keeper,
        associated_token::mint = mint,
        associated_token::authority = keeper,
        associated_token::token_program = token_program,
    )]
    pub keeper_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn take_fee_tokens(ctx: Context<TakeFeeTokens>, amount: u64) -> Result<()> {
    let ts = &mut ctx.accounts.token_state;
    require!(ts.complete, FirepadError::NotGraduated);
    require!(amount > 0 && amount <= ts.pending_fee_tokens, FirepadError::NothingToCollect);
    ts.pending_fee_tokens -= amount;
    ts.fee_tokens_to_keeper_total = ts.fee_tokens_to_keeper_total.checked_add(amount).ok_or(FirepadError::MathOverflow)?;
    let mint_key = ts.mint;
    let ts_bump = ts.bump;

    // This transfer is itself charged the fee; that slice is collected next round.
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.curve_vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.keeper_ata.to_account_info(),
                authority: ctx.accounts.token_state.to_account_info(),
            },
            &[&[b"token", mint_key.as_ref(), &[ts_bump]]],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    msg!("KEEPER took {} fee tokens to swap", amount);
    Ok(())
}

#[derive(Accounts)]
pub struct DepositSwappedFees<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump, has_one = keeper @ FirepadError::NotKeeper)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"token", token_state.mint.as_ref()], bump = token_state.bump)]
    pub token_state: Account<'info, TokenState>,

    #[account(mut, seeds = [b"creator_vault", token_state.mint.as_ref()], bump = token_state.creator_vault_bump)]
    pub creator_vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"reward_vault", token_state.mint.as_ref()], bump = token_state.reward_vault_bump)]
    pub reward_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn deposit_swapped_fees(ctx: Context<DepositSwappedFees>, lamports: u64) -> Result<()> {
    require!(lamports > 0, FirepadError::ZeroAmount);
    let (creator, holders) = split_fee(lamports)?;
    let ts = &mut ctx.accounts.token_state;
    ts.credit_fees(creator, holders)?;
    ts.keeper_sol_deposited_total = ts.keeper_sol_deposited_total.checked_add(lamports).ok_or(FirepadError::MathOverflow)?;

    for (to, amount) in [(&ctx.accounts.creator_vault, creator), (&ctx.accounts.reward_vault, holders)] {
        if amount > 0 {
            sys_transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    SysTransfer { from: ctx.accounts.keeper.to_account_info(), to: to.to_account_info() },
                ),
                amount,
            )?;
        }
    }
    msg!("FEES swapped {} SOL (creator {} / holders {})", lamports, creator, holders);
    Ok(())
}
