use anchor_lang::prelude::*;

// Codes are 6000 + position. lib/errors.ts mirrors this list — keep them in sync,
// and only append new variants (inserting shifts every later code).
#[error_code]
pub enum FirepadError {
    #[msg("Fee basis points too high (max 1000 = 10%)")]
    FeeTooHigh,
    #[msg("Slippage exceeded: output below minimum")]
    SlippageExceeded,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Bonding curve has already completed (graduated)")]
    CurveComplete,
    #[msg("Insufficient reserves in the curve")]
    InsufficientReserves,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Only the creator may perform this action")]
    NotCreator,
    #[msg("Only the config authority may perform this action")]
    NotAuthority,
    #[msg("Only the keeper may perform this action")]
    NotKeeper,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Invalid mint for this account")]
    InvalidMint,
    #[msg("Name (1-32), symbol (1-10) or URI (max 200) has an invalid length")]
    BadMetadata,
    #[msg("Invalid curve parameters")]
    BadCurve,
    #[msg("The curve hasn't graduated yet")]
    NotGraduated,
    #[msg("This coin has already migrated to Raydium")]
    AlreadyMigrated,
    #[msg("Invalid merkle proof")]
    InvalidProof,
    #[msg("Rewards root must be the next epoch, monotonic, and within the holder pool")]
    BadRewardsRoot,
    #[msg("No fees to collect")]
    NothingToCollect,
    #[msg("Not enough SOL in the curve to fund the DEX pool")]
    MigrationTooSmall,
}
