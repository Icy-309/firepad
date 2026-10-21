//! Program-controlled graduation. Once a curve sells out, anyone (the keeper in
//! practice) calls `migrate`, which in one instruction:
//!   1. wraps the curve's SOL into WSOL and moves the reserved token supply into
//!      accounts owned by the token's `sol_vault` PDA;
//!   2. creates a Raydium CPMM pool with them (sol_vault is the pool creator, so the
//!      pool opens at the curve's final price);
//!   3. burns every LP token, so the liquidity is locked forever;
//!   4. splits any SOL left over from the pool fee/rent reserve 50/50 to creator/holders.
//! No key — not even the protocol authority — ever holds the liquidity.

use super::vault_pay;
use crate::curve::split_fee;
use crate::errors::FirepadError;
use crate::state::TokenState;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_lang::system_program::{transfer as sys_transfer, Transfer as SysTransfer};
use anchor_spl::associated_token::{self, get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token::{self, spl_token, Token};
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked};

/// Raydium CPMM addresses (see raydium-io/raydium-cp-swap, programs/cp-swap/src/lib.rs).
pub mod raydium {
    use anchor_lang::solana_program::pubkey::Pubkey;

    #[cfg(feature = "devnet")]
    pub const CPMM: Pubkey = Pubkey::new_from_array([184, 152, 153, 121, 45, 202, 82, 52, 121, 111, 231, 116, 98, 176, 49, 223, 70, 63, 95, 254, 174, 54, 124, 92, 15, 251, 36, 110, 28, 183, 206, 12]); // DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb
    #[cfg(not(feature = "devnet"))]
    pub const CPMM: Pubkey = Pubkey::new_from_array([169, 42, 90, 139, 79, 41, 89, 82, 132, 37, 80, 170, 147, 253, 91, 149, 181, 172, 230, 168, 235, 146, 12, 147, 148, 46, 67, 105, 12, 32, 236, 115]); // CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C

    /// amm_config index 0: 0.25% trade fee, 0.15 SOL pool creation fee.
    #[cfg(feature = "devnet")]
    pub const AMM_CONFIG: Pubkey = Pubkey::new_from_array([64, 204, 239, 185, 92, 30, 41, 118, 123, 110, 3, 22, 133, 89, 160, 184, 248, 41, 216, 120, 182, 25, 71, 9, 51, 238, 138, 74, 72, 118, 60, 140]); // 5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy
    #[cfg(not(feature = "devnet"))]
    pub const AMM_CONFIG: Pubkey = Pubkey::new_from_array([179, 33, 63, 186, 139, 249, 200, 127, 169, 30, 71, 129, 150, 40, 195, 131, 224, 11, 234, 126, 152, 199, 160, 62, 3, 186, 16, 105, 207, 195, 246, 243]); // D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2

    #[cfg(feature = "devnet")]
    pub const CREATE_POOL_FEE: Pubkey = Pubkey::new_from_array([41, 142, 222, 224, 62, 190, 43, 214, 66, 152, 140, 173, 72, 183, 122, 97, 23, 207, 235, 156, 24, 211, 155, 20, 225, 145, 245, 228, 87, 13, 86, 186]); // 3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy
    #[cfg(not(feature = "devnet"))]
    pub const CREATE_POOL_FEE: Pubkey = Pubkey::new_from_array([183, 208, 34, 82, 84, 172, 7, 227, 178, 189, 63, 134, 193, 240, 241, 16, 63, 192, 112, 140, 193, 90, 239, 20, 7, 58, 166, 69, 63, 85, 234, 105]); // DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8

    /// sha256("global:initialize")[..8]
    pub const INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
}

/// Kept back from the curve's SOL for Raydium's 0.15 SOL pool fee and the rent of the
/// accounts the migration creates (pool, observation, LP mint, vaults, our ATAs).
/// Whatever isn't spent goes to creator/holders at the end.
pub const MIGRATION_RESERVE: u64 = 250_000_000;

#[derive(Accounts)]
pub struct Migrate<'info> {
    /// Anyone. Pays only the transaction fee.
    pub caller: Signer<'info>,

    #[account(mut, seeds = [b"token", mint.key().as_ref()], bump = token_state.bump)]
    pub token_state: Box<Account<'info, TokenState>>,

    #[account(mint::token_program = token_2022_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = token_state,
        associated_token::token_program = token_2022_program,
    )]
    pub curve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Holds the curve's SOL; becomes the Raydium pool creator and fee payer.
    #[account(mut, seeds = [b"sol_vault", mint.key().as_ref()], bump = token_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"creator_vault", mint.key().as_ref()], bump = token_state.creator_vault_bump)]
    pub creator_vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"reward_vault", mint.key().as_ref()], bump = token_state.reward_vault_bump)]
    pub reward_vault: SystemAccount<'info>,

    /// CHECK: sol_vault's WSOL ATA (address pinned), created here.
    #[account(mut, address = get_associated_token_address_with_program_id(&sol_vault.key(), &spl_token::native_mint::ID, &token_program.key()))]
    pub vault_wsol: UncheckedAccount<'info>,
    /// CHECK: sol_vault's ATA for this token (address pinned), created here.
    #[account(mut, address = get_associated_token_address_with_program_id(&sol_vault.key(), &mint.key(), &token_2022_program.key()))]
    pub vault_token: UncheckedAccount<'info>,
    /// CHECK: the WSOL mint.
    #[account(address = spl_token::native_mint::ID)]
    pub wsol_mint: UncheckedAccount<'info>,

    // ---- Raydium CPMM. Raydium itself checks every PDA below against its seeds;
    //      the program, config and fee receiver are pinned here. ----
    /// CHECK: Raydium CPMM program.
    #[account(address = raydium::CPMM)]
    pub cpmm_program: UncheckedAccount<'info>,
    /// CHECK: pool config (pinned).
    #[account(address = raydium::AMM_CONFIG)]
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: Raydium vault/LP authority PDA.
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: pool state PDA (created by Raydium).
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: LP mint PDA (created by Raydium).
    #[account(mut)]
    pub lp_mint: UncheckedAccount<'info>,
    /// CHECK: sol_vault's LP ATA (created by Raydium); every LP token is burned.
    #[account(mut, address = get_associated_token_address_with_program_id(&sol_vault.key(), &lp_mint.key(), &token_program.key()))]
    pub vault_lp: UncheckedAccount<'info>,
    /// CHECK: pool vault for token_0 (created by Raydium).
    #[account(mut)]
    pub token_0_vault: UncheckedAccount<'info>,
    /// CHECK: pool vault for token_1 (created by Raydium).
    #[account(mut)]
    pub token_1_vault: UncheckedAccount<'info>,
    /// CHECK: Raydium's pool-creation fee receiver (pinned).
    #[account(mut, address = raydium::CREATE_POOL_FEE)]
    pub create_pool_fee: UncheckedAccount<'info>,
    /// CHECK: oracle observation PDA (created by Raydium).
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Balance of an SPL / Token-2022 token account (amount is at bytes 64..72 in both).
fn token_amount(info: &AccountInfo) -> Result<u64> {
    let data = info.try_borrow_data()?;
    require!(data.len() >= 72, FirepadError::InvalidMint);
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
    let ts = &ctx.accounts.token_state;
    require!(ts.complete, FirepadError::NotGraduated);
    require!(!ts.migrated, FirepadError::AlreadyMigrated);

    let mint_key = ts.mint;
    let sol_bump = ts.sol_vault_bump;
    let ts_bump = ts.bump;
    let sol_seeds: &[&[u8]] = &[b"sol_vault", mint_key.as_ref(), &[sol_bump]];
    let ts_seeds: &[&[u8]] = &[b"token", mint_key.as_ref(), &[ts_bump]];

    let pool_sol = ts
        .real_sol_reserves
        .checked_sub(MIGRATION_RESERVE)
        .filter(|s| *s > 0)
        .ok_or(FirepadError::MigrationTooSmall)?;
    // Everything in the curve vault except fee tokens still waiting to be swapped.
    let tokens = ctx
        .accounts
        .curve_vault
        .amount
        .checked_sub(ts.pending_fee_tokens)
        .filter(|t| *t > 0)
        .ok_or(FirepadError::MigrationTooSmall)?;

    let a = &ctx.accounts;
    let sys = a.system_program.to_account_info();
    let sol_vault = a.sol_vault.to_account_info();

    // 1) SOL side: sol_vault's WSOL account, funded and synced.
    associated_token::create(CpiContext::new_with_signer(
        a.associated_token_program.to_account_info(),
        associated_token::Create {
            payer: sol_vault.clone(),
            associated_token: a.vault_wsol.to_account_info(),
            authority: sol_vault.clone(),
            mint: a.wsol_mint.to_account_info(),
            system_program: sys.clone(),
            token_program: a.token_program.to_account_info(),
        },
        &[sol_seeds],
    ))?;
    sys_transfer(
        CpiContext::new_with_signer(
            sys.clone(),
            SysTransfer { from: sol_vault.clone(), to: a.vault_wsol.to_account_info() },
            &[sol_seeds],
        ),
        pool_sol,
    )?;
    token::sync_native(CpiContext::new(
        a.token_program.to_account_info(),
        token::SyncNative { account: a.vault_wsol.to_account_info() },
    ))?;

    // 2) Token side: the reserved supply into sol_vault's token account. (The transfer
    //    fee withheld here is harvested and split like any other fee.)
    associated_token::create(CpiContext::new_with_signer(
        a.associated_token_program.to_account_info(),
        associated_token::Create {
            payer: sol_vault.clone(),
            associated_token: a.vault_token.to_account_info(),
            authority: sol_vault.clone(),
            mint: a.mint.to_account_info(),
            system_program: sys.clone(),
            token_program: a.token_2022_program.to_account_info(),
        },
        &[sol_seeds],
    ))?;
    transfer_checked(
        CpiContext::new_with_signer(
            a.token_2022_program.to_account_info(),
            TransferChecked {
                from: a.curve_vault.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.vault_token.to_account_info(),
                authority: a.token_state.to_account_info(),
            },
            &[ts_seeds],
        ),
        tokens,
        a.mint.decimals,
    )?;
    let pool_tokens = token_amount(&a.vault_token.to_account_info())?;

    // 3) Raydium CPMM initialize. Mints must be ordered (token_0 < token_1).
    let wsol = spl_token::native_mint::ID;
    let wsol_first = wsol < mint_key;
    let (m0, m1) = if wsol_first { (wsol, mint_key) } else { (mint_key, wsol) };
    let (acct0, acct1) = if wsol_first {
        (a.vault_wsol.key(), a.vault_token.key())
    } else {
        (a.vault_token.key(), a.vault_wsol.key())
    };
    let (prog0, prog1) = if wsol_first {
        (a.token_program.key(), a.token_2022_program.key())
    } else {
        (a.token_2022_program.key(), a.token_program.key())
    };
    let (amt0, amt1) = if wsol_first { (pool_sol, pool_tokens) } else { (pool_tokens, pool_sol) };

    let mut data = raydium::INITIALIZE.to_vec();
    data.extend_from_slice(&amt0.to_le_bytes());
    data.extend_from_slice(&amt1.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // open_time: now
    let ix = Instruction {
        program_id: raydium::CPMM,
        accounts: vec![
            AccountMeta::new(a.sol_vault.key(), true),
            AccountMeta::new_readonly(a.amm_config.key(), false),
            AccountMeta::new_readonly(a.cpmm_authority.key(), false),
            AccountMeta::new(a.pool_state.key(), false),
            AccountMeta::new_readonly(m0, false),
            AccountMeta::new_readonly(m1, false),
            AccountMeta::new(a.lp_mint.key(), false),
            AccountMeta::new(acct0, false),
            AccountMeta::new(acct1, false),
            AccountMeta::new(a.vault_lp.key(), false),
            AccountMeta::new(a.token_0_vault.key(), false),
            AccountMeta::new(a.token_1_vault.key(), false),
            AccountMeta::new(a.create_pool_fee.key(), false),
            AccountMeta::new(a.observation_state.key(), false),
            AccountMeta::new_readonly(a.token_program.key(), false),
            AccountMeta::new_readonly(prog0, false),
            AccountMeta::new_readonly(prog1, false),
            AccountMeta::new_readonly(a.associated_token_program.key(), false),
            AccountMeta::new_readonly(a.system_program.key(), false),
            AccountMeta::new_readonly(a.rent.key(), false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            sol_vault.clone(),
            a.amm_config.to_account_info(),
            a.cpmm_authority.to_account_info(),
            a.pool_state.to_account_info(),
            a.wsol_mint.to_account_info(),
            a.mint.to_account_info(),
            a.lp_mint.to_account_info(),
            a.vault_wsol.to_account_info(),
            a.vault_token.to_account_info(),
            a.vault_lp.to_account_info(),
            a.token_0_vault.to_account_info(),
            a.token_1_vault.to_account_info(),
            a.create_pool_fee.to_account_info(),
            a.observation_state.to_account_info(),
            a.token_program.to_account_info(),
            a.token_2022_program.to_account_info(),
            a.associated_token_program.to_account_info(),
            sys.clone(),
            a.rent.to_account_info(),
            a.cpmm_program.to_account_info(),
        ],
        &[sol_seeds],
    )?;

    // 4) Burn every LP token: the pool's liquidity can never be withdrawn.
    let lp = token_amount(&a.vault_lp.to_account_info())?;
    token::burn(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            token::Burn {
                mint: a.lp_mint.to_account_info(),
                from: a.vault_lp.to_account_info(),
                authority: sol_vault.clone(),
            },
            &[sol_seeds],
        ),
        lp,
    )?;

    // 5) Unspent reserve → creator / holders, keeping sol_vault rent-exempt.
    let leftover = sol_vault.lamports().saturating_sub(Rent::get()?.minimum_balance(0));
    let (creator, holders) = split_fee(leftover)?;
    vault_pay(&sys, &sol_vault, &a.creator_vault.to_account_info(), sol_seeds, creator)?;
    vault_pay(&sys, &sol_vault, &a.reward_vault.to_account_info(), sol_seeds, holders)?;

    let pool = a.pool_state.key();
    let ts = &mut ctx.accounts.token_state;
    ts.credit_fees(creator, holders)?;
    ts.real_sol_reserves = 0;
    ts.migrated = true;
    msg!(
        "MIGRATED to Raydium CPMM pool {}: {} lamports + {} tokens, {} LP burned, {} lamports leftover split",
        pool,
        pool_sol,
        pool_tokens,
        lp,
        leftover
    );
    Ok(())
}
