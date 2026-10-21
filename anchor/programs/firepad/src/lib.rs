use anchor_lang::prelude::*;

pub mod curve;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::CurveParams;

// Program id (keypair: anchor/target/deploy/firepad-keypair.json).
declare_id!("2itmJRT2GFcfAP7uWJky1LQGwACqLJgU8jZ1pWirAbho");

#[program]
pub mod firepad {
    use super::*;

    // ---- admin ----

    /// One-time: token fee for launches, keeper, and the launch curve
    /// (use `CurveParams::PUMP_FUN` for pump.fun-identical launches).
    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16, keeper: Pubkey, curve: CurveParams) -> Result<()> {
        instructions::initialize(ctx, fee_bps, keeper, curve)
    }

    /// Change fee / curve (new launches only), keeper, authority — never the 50/50 split.
    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
        instructions::update_config(ctx, params)
    }

    /// Permissionless, after a curve sells out: create its Raydium CPMM pool from the
    /// curve's SOL + reserved tokens and burn the LP, so the liquidity is locked forever.
    pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
        instructions::migrate(ctx)
    }

    // ---- launch & trade ----

    /// Create a Token-2022 mint (transfer fee + metadata) and seed the bonding curve.
    pub fn create_token(ctx: Context<CreateToken>, params: CreateTokenParams) -> Result<()> {
        instructions::create_token(ctx, params)
    }

    /// Buy tokens from the curve with SOL (the fee is withheld from the tokens).
    pub fn buy(ctx: Context<Buy>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        instructions::buy(ctx, sol_in, min_tokens_out)
    }

    /// Sell tokens back to the curve for SOL (the fee is withheld from the tokens).
    pub fn sell(ctx: Context<Sell>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        instructions::sell(ctx, tokens_in, min_sol_out)
    }

    // ---- fees: tokens → SOL → 50% creator / 50% holders ----

    /// Permissionless: pull harvested fee tokens into the curve vault and, before
    /// graduation, sell them into the curve and split the SOL 50/50.
    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        instructions::collect_fees(ctx)
    }

    /// Keeper, after graduation: take collected fee tokens to swap on a DEX.
    pub fn take_fee_tokens(ctx: Context<TakeFeeTokens>, amount: u64) -> Result<()> {
        instructions::take_fee_tokens(ctx, amount)
    }

    /// Keeper, after graduation: deposit the swap proceeds, split 50/50.
    pub fn deposit_swapped_fees(ctx: Context<DepositSwappedFees>, lamports: u64) -> Result<()> {
        instructions::deposit_swapped_fees(ctx, lamports)
    }

    // ---- claims ----

    /// Keeper: publish the next holder-reward merkle root.
    pub fn set_rewards_root(ctx: Context<SetRewardsRoot>, root: [u8; 32], total: u64, epoch: u32) -> Result<()> {
        instructions::set_rewards_root(ctx, root, total, epoch)
    }

    /// Holder claims their share with a merkle proof of their cumulative allocation.
    pub fn claim_rewards(ctx: Context<ClaimRewards>, cumulative: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        instructions::claim_rewards(ctx, cumulative, proof)
    }

    /// Creator withdraws their 50%.
    pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
        instructions::claim_creator_fees(ctx)
    }
}
