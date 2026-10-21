//! Constant-product bonding curve with virtual reserves.
//!
//! Price is defined by `x * y = k`, where `x = sol_reserves` and
//! `y = token_reserves`. Virtual reserves seed an initial price and smooth the
//! early curve (the pump.fun approach), so the first buyer doesn't get the
//! supply for free. All rounding favors the curve, never the trader.

use crate::errors::FirepadError;
use anchor_lang::prelude::*;

fn k(virtual_sol: u64, virtual_token: u64) -> Result<u128> {
    Ok((virtual_sol as u128)
        .checked_mul(virtual_token as u128)
        .ok_or(FirepadError::MathOverflow)?)
}

fn div_ceil(a: u128, b: u128) -> Result<u128> {
    require!(b > 0, FirepadError::MathOverflow);
    Ok(a / b + u128::from(a % b != 0))
}

/// Given `sol_in` (already net of fees), return tokens out.
pub fn tokens_out_for_sol_in(virtual_sol: u64, virtual_token: u64, sol_in: u64) -> Result<u64> {
    let new_vsol = (virtual_sol as u128)
        .checked_add(sol_in as u128)
        .ok_or(FirepadError::MathOverflow)?;
    let new_vtoken = div_ceil(k(virtual_sol, virtual_token)?, new_vsol)?;
    let tokens_out = (virtual_token as u128)
        .checked_sub(new_vtoken)
        .ok_or(FirepadError::MathOverflow)?;
    Ok(tokens_out as u64)
}

/// SOL (net of fees) required to buy exactly `tokens_out`.
pub fn sol_in_for_tokens_out(virtual_sol: u64, virtual_token: u64, tokens_out: u64) -> Result<u64> {
    let new_vtoken = (virtual_token as u128)
        .checked_sub(tokens_out as u128)
        .ok_or(FirepadError::MathOverflow)?;
    let new_vsol = div_ceil(k(virtual_sol, virtual_token)?, new_vtoken)?;
    let sol_in = new_vsol
        .checked_sub(virtual_sol as u128)
        .ok_or(FirepadError::MathOverflow)?;
    u64::try_from(sol_in).map_err(|_| error!(FirepadError::MathOverflow))
}

/// Given `tokens_in`, return SOL out (gross, before fee).
pub fn sol_out_for_tokens_in(virtual_sol: u64, virtual_token: u64, tokens_in: u64) -> Result<u64> {
    let new_vtoken = (virtual_token as u128)
        .checked_add(tokens_in as u128)
        .ok_or(FirepadError::MathOverflow)?;
    let new_vsol = div_ceil(k(virtual_sol, virtual_token)?, new_vtoken)?;
    let sol_out = (virtual_sol as u128)
        .checked_sub(new_vsol)
        .ok_or(FirepadError::MathOverflow)?;
    Ok(sol_out as u64)
}

/// Split swapped fee SOL into (creator_cut, holder_cut): strictly 50/50, fixed in code.
pub fn split_fee(fee: u64) -> Result<(u64, u64)> {
    let creator = ((fee as u128) * crate::state::CREATOR_SHARE_BPS as u128 / 10_000u128) as u64;
    let holder = fee.checked_sub(creator).ok_or(FirepadError::MathOverflow)?;
    Ok((creator, holder))
}
