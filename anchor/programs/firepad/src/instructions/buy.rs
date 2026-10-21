use super::transfer_fee_for;
use crate::curve::{sol_in_for_tokens_out, tokens_out_for_sol_in};
use crate::errors::FirepadError;
use crate::state::TokenState;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer as sys_transfer, Transfer as SysTransfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

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
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_ata: InterfaceAccount<'info, TokenAccount>,

    /// Curve's SOL reserves (system-owned PDA, zero data).
    #[account(mut, seeds = [b"sol_vault", mint.key().as_ref()], bump = token_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Buy with `sol_in` lamports. All SOL goes to the curve; the fee is the token
/// transfer fee withheld from the tokens the buyer receives.
/// `min_tokens_out` is checked against what actually lands in the buyer's account.
pub fn buy(ctx: Context<Buy>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
    require!(sol_in > 0, FirepadError::ZeroAmount);
    let ts = &mut ctx.accounts.token_state;
    require!(!ts.complete, FirepadError::CurveComplete);

    let mut sol_used = sol_in;
    let mut tokens_out = tokens_out_for_sol_in(ts.virtual_sol_reserves, ts.virtual_token_reserves, sol_in)?;
    // Final buy: cap at what's left in the curve and only charge for that (pump.fun behaviour).
    if tokens_out > ts.real_token_reserves {
        tokens_out = ts.real_token_reserves;
        sol_used = sol_in_for_tokens_out(ts.virtual_sol_reserves, ts.virtual_token_reserves, tokens_out)?.min(sol_in);
    }
    require!(tokens_out > 0, FirepadError::ZeroAmount);

    let fee = transfer_fee_for(&ctx.accounts.mint.to_account_info(), tokens_out)?;
    let received = tokens_out.checked_sub(fee).ok_or(FirepadError::MathOverflow)?;
    require!(received >= min_tokens_out, FirepadError::SlippageExceeded);

    ts.virtual_sol_reserves = ts.virtual_sol_reserves.checked_add(sol_used).ok_or(FirepadError::MathOverflow)?;
    ts.virtual_token_reserves = ts.virtual_token_reserves.checked_sub(tokens_out).ok_or(FirepadError::MathOverflow)?;
    ts.real_sol_reserves = ts.real_sol_reserves.checked_add(sol_used).ok_or(FirepadError::MathOverflow)?;
    ts.real_token_reserves = ts.real_token_reserves.checked_sub(tokens_out).ok_or(FirepadError::MathOverflow)?;
    // Graduates when the sellable supply is gone (≈85 SOL raised on the pump.fun curve).
    if ts.real_token_reserves == 0 {
        ts.complete = true;
        msg!("Curve graduated at {} lamports raised", ts.real_sol_reserves);
    }
    let mint_key = ts.mint;
    let ts_bump = ts.bump;

    sys_transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            SysTransfer { from: ctx.accounts.buyer.to_account_info(), to: ctx.accounts.sol_vault.to_account_info() },
        ),
        sol_used,
    )?;

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.curve_vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyer_ata.to_account_info(),
                authority: ctx.accounts.token_state.to_account_info(),
            },
            &[&[b"token", mint_key.as_ref(), &[ts_bump]]],
        ),
        tokens_out,
        ctx.accounts.mint.decimals,
    )?;

    // Parsed by the UI's trade list: lamports in, gross tokens out.
    msg!("BUY {} SOL -> {} tokens (fee {} tokens)", sol_used, tokens_out, fee);
    Ok(())
}
