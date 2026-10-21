use anchor_lang::prelude::*;

/// The fee split is fixed by the program, not configurable: exactly half of every
/// fee (after it is swapped to SOL) goes to the token's creator, the other half to
/// its holders (holders get the odd lamport). See `curve::split_fee`.
pub const CREATOR_SHARE_BPS: u16 = 5_000;

/// Global protocol config (one per deployment).
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    /// Bot that collects/swaps fees post-graduation and publishes holder-reward roots.
    pub keeper: Pubkey,
    /// Token-2022 transfer fee (bps) baked into NEW mints. Immutable per token once
    /// launched (the mint's transfer-fee config authority is set to None).
    pub fee_bps: u16,
    /// Curve parameters applied to every launch (see `CurveParams::PUMP_FUN`).
    pub curve: CurveParams,
    pub bump: u8,
}

/// Bonding-curve launch parameters, identical for every token.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct CurveParams {
    pub initial_virtual_sol_reserves: u64,
    pub initial_virtual_token_reserves: u64,
    /// Tokens sellable through the curve. The rest of the supply stays in the
    /// curve vault, reserved for DEX liquidity at graduation.
    pub initial_real_token_reserves: u64,
    pub token_total_supply: u64,
    pub decimals: u8,
}

impl CurveParams {
    /// pump.fun's launch curve: 1B supply (6 decimals), 30 SOL / 1.073B virtual
    /// reserves, 793.1M sold through the curve.
    /// Starting price ≈ 0.000000028 SOL, starting market cap ≈ 28 SOL;
    /// selling out the curve raises ≈ 85 SOL (market cap ≈ 410 SOL at graduation).
    pub const PUMP_FUN: CurveParams = CurveParams {
        initial_virtual_sol_reserves: 30_000_000_000,              // 30 SOL
        initial_virtual_token_reserves: 1_073_000_000_000_000,     // 1.073B tokens
        initial_real_token_reserves: 793_100_000_000_000,          // 793.1M tokens
        token_total_supply: 1_000_000_000_000_000,                 // 1B tokens
        decimals: 6,
    };

    /// The curve must be able to sell out (virtual > real) and the sellable part
    /// must fit in the minted supply.
    pub fn validate(&self) -> Result<()> {
        require!(
            self.initial_virtual_sol_reserves > 0
                && self.initial_real_token_reserves > 0
                && self.initial_real_token_reserves < self.initial_virtual_token_reserves
                && self.initial_real_token_reserves <= self.token_total_supply,
            crate::errors::FirepadError::BadCurve
        );
        Ok(())
    }
}

/// Per-token launchpad state + bonding curve + fee/reward accounting.
/// PDA: seeds = [b"token", mint].
///
/// Curve vault token balance = real_token_reserves + graduation reserve
/// + pending_fee_tokens (collected fees not yet swapped).
#[account]
#[derive(InitSpace)]
pub struct TokenState {
    pub mint: Pubkey,
    pub creator: Pubkey,
    /// Virtual reserves implement the constant-product curve (pump.fun style).
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    /// Real reserves actually held/owed by the curve.
    pub real_sol_reserves: u64,
    pub real_token_reserves: u64,
    /// Total token supply minted to the curve vault at creation.
    pub token_total_supply: u64,
    /// Curve-sellable portion of the supply at creation (real_token_reserves at t=0).
    pub initial_real_token_reserves: u64,
    /// Creator's 50% (lamports) accrued and not yet withdrawn.
    pub creator_fees_owed: u64,
    /// Holders' 50% (lamports) ever credited to this token's reward vault.
    pub holder_fees_total: u64,
    /// Merkle root of cumulative per-wallet holder rewards, published by the keeper.
    pub rewards_root: [u8; 32],
    /// Sum of all cumulative amounts in `rewards_root` (≤ holder_fees_total).
    pub rewards_root_total: u64,
    /// Increments with every published root.
    pub rewards_epoch: u32,
    /// Lamports holders have claimed so far (≤ rewards_root_total).
    pub holder_claimed_total: u64,
    /// Collected fee tokens sitting in the curve vault awaiting a post-graduation swap.
    pub pending_fee_tokens: u64,
    /// Transparency counters for keeper swaps: tokens handed out / SOL deposited back.
    pub fee_tokens_to_keeper_total: u64,
    pub keeper_sol_deposited_total: u64,
    /// True once the curve sells out and trading via the curve stops.
    pub complete: bool,
    /// Set once the graduated curve's liquidity was withdrawn for DEX migration.
    pub migrated: bool,
    pub bump: u8,
    pub sol_vault_bump: u8,
    pub reward_vault_bump: u8,
    pub creator_vault_bump: u8,
}

impl TokenState {
    /// Split swapped fee SOL 50/50 into the books (callers move the lamports).
    pub fn credit_fees(&mut self, creator: u64, holders: u64) -> Result<()> {
        self.creator_fees_owed = self
            .creator_fees_owed
            .checked_add(creator)
            .ok_or(crate::errors::FirepadError::MathOverflow)?;
        self.holder_fees_total = self
            .holder_fees_total
            .checked_add(holders)
            .ok_or(crate::errors::FirepadError::MathOverflow)?;
        Ok(())
    }
}

/// How much a wallet has claimed from the holder-reward merkle distributions.
/// PDA: seeds = [b"claim", mint, owner].
#[account]
#[derive(InitSpace)]
pub struct ClaimStatus {
    pub claimed: u64,
    pub bump: u8,
}
