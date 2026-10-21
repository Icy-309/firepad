use super::vault_pay;
use crate::curve::sol_out_for_tokens_in;
use crate::errors::FirepadError;
use crate::state::TokenState;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

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
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
        associated_token::token_program = token_program,
    )]
    pub seller_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [b"sol_vault", mint.key().as_ref()], bump = token_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Sell `tokens_in`. The transfer fee is withheld from what reaches the curve
/// (collected later by `collect_fees`); the seller is paid for the tokens the
/// curve actually received.
pub fn sell(ctx: Context<Sell>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
    require!(tokens_in > 0, FirepadError::ZeroAmount);
    require!(!ctx.accounts.token_state.complete, FirepadError::CurveComplete);

    let before = ctx.accounts.curve_vault.amount;
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.seller_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.curve_vault.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        tokens_in,
        ctx.accounts.mint.decimals,
    )?;
    ctx.accounts.curve_vault.reload()?;
    let received = ctx
        .accounts
        .curve_vault
        .amount
        .checked_sub(before)
        .ok_or(FirepadError::MathOverflow)?;

    let ts = &mut ctx.accounts.token_state;
    let sol_out = sol_out_for_tokens_in(ts.virtual_sol_reserves, ts.virtual_token_reserves, received)?;
    require!(sol_out >= min_sol_out, FirepadError::SlippageExceeded);
    require!(ts.real_sol_reserves >= sol_out, FirepadError::InsufficientReserves);

    ts.virtual_token_reserves = ts.virtual_token_reserves.checked_add(received).ok_or(FirepadError::MathOverflow)?;
    ts.virtual_sol_reserves = ts.virtual_sol_reserves.checked_sub(sol_out).ok_or(FirepadError::MathOverflow)?;
    ts.real_token_reserves = ts.real_token_reserves.checked_add(received).ok_or(FirepadError::MathOverflow)?;
    ts.real_sol_reserves = ts.real_sol_reserves.checked_sub(sol_out).ok_or(FirepadError::MathOverflow)?;
    let mint_key = ts.mint;
    let vault_bump = ts.sol_vault_bump;

    vault_pay(
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.sol_vault.to_account_info(),
        &ctx.accounts.seller.to_account_info(),
        &[b"sol_vault", mint_key.as_ref(), &[vault_bump]],
        sol_out,
    )?;

    // Parsed by the UI's trade list: gross tokens in, lamports out.
    msg!("SELL {} tokens -> {} SOL (curve received {})", tokens_in, sol_out, received);
    Ok(())
}
