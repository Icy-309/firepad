use crate::errors::FirepadError;
use crate::state::{Config, TokenState};
use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        metadata_pointer::instruction as pointer_ix, transfer_fee::instruction as fee_ix, ExtensionType,
    },
    instruction::{initialize_mint2, AuthorityType},
    state::Mint as MintState,
};
use anchor_spl::token_2022::{mint_to, set_authority, MintTo, SetAuthority, Token2022};

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateTokenParams {
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// The new mint (a pre-ground "...fire" vanity keypair). Created manually (CPI)
    /// so we can add the transfer-fee and metadata extensions.
    #[account(mut)]
    pub mint: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + TokenState::INIT_SPACE,
        seeds = [b"token", mint.key().as_ref()],
        bump
    )]
    pub token_state: Account<'info, TokenState>,

    /// Holds the curve's token inventory (and collected fee tokens): token_state's ATA.
    /// CHECK: address pinned here; created in the handler once the mint exists.
    /// (Anchor's `init` would run during account validation, before the mint is created.)
    #[account(
        mut,
        address = get_associated_token_address_with_program_id(&token_state.key(), &mint.key(), &token_program.key())
            @ FirepadError::InvalidMint
    )]
    pub curve_vault: UncheckedAccount<'info>,

    /// SOL vaults (system-owned PDAs). Seeded with the rent-exempt minimum here so
    /// later payouts never leave them in a rent-paying state.
    #[account(mut, seeds = [b"sol_vault", mint.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"creator_vault", mint.key().as_ref()], bump)]
    pub creator_vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"reward_vault", mint.key().as_ref()], bump)]
    pub reward_vault: SystemAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_token(ctx: Context<CreateToken>, params: CreateTokenParams) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let curve = ctx.accounts.config.curve;
    let fee_bps = ctx.accounts.config.fee_bps;

    require!(
        !params.name.is_empty() && params.name.len() <= MAX_NAME_LEN,
        FirepadError::BadMetadata
    );
    require!(
        !params.symbol.is_empty() && params.symbol.len() <= MAX_SYMBOL_LEN,
        FirepadError::BadMetadata
    );
    require!(params.uri.len() <= MAX_URI_LEN, FirepadError::BadMetadata);

    let ts_bump = ctx.bumps.token_state;
    let ts_key = ctx.accounts.token_state.key();
    let signer_seeds: &[&[&[u8]]] = &[&[b"token", mint_key.as_ref(), &[ts_bump]]];
    let token_program_id = ctx.accounts.token_program.key();
    let mint_and_program = [
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    ];

    // 1) Create the mint account. `space` covers only the fixed-size extensions
    //    (InitializeMint rejects anything else); lamports also cover the variable-length
    //    TokenMetadata entry, which Token-2022 reallocs into during step 4.
    let space = ExtensionType::try_calculate_account_len::<MintState>(&[
        ExtensionType::TransferFeeConfig,
        ExtensionType::MetadataPointer,
    ])
    .map_err(|_| error!(FirepadError::MathOverflow))?;
    // TLV header (type u16 + length u16) + update_authority + mint
    // + 3 u32-length-prefixed strings + empty additional_metadata vec.
    let metadata_len = 2 + 2 + 32 + 32
        + 4 + params.name.len()
        + 4 + params.symbol.len()
        + 4 + params.uri.len()
        + 4;
    let lamports = ctx.accounts.rent.minimum_balance(space + metadata_len);

    create_account(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            CreateAccount {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        lamports,
        space as u64,
        &token_program_id,
    )?;

    // 2) Transfer fee: `fee_bps` of every transfer is withheld in the recipient's
    //    account. No config authority → the rate can never change for this token.
    //    Withdraw authority = token_state PDA, so only this program moves fees.
    let init_fee_ix = fee_ix::initialize_transfer_fee_config(
        &token_program_id,
        &mint_key,
        None,
        Some(&ts_key),
        fee_bps,
        u64::MAX,
    )
    .map_err(|_| error!(FirepadError::InvalidMint))?;
    anchor_lang::solana_program::program::invoke(&init_fee_ix, &mint_and_program)?;

    // 2b) Metadata lives on the mint itself.
    let init_pointer_ix = pointer_ix::initialize(&token_program_id, &mint_key, Some(ts_key), Some(mint_key))
        .map_err(|_| error!(FirepadError::InvalidMint))?;
    anchor_lang::solana_program::program::invoke(&init_pointer_ix, &mint_and_program)?;

    // 3) Initialize the mint itself (authority = token_state PDA, no freeze authority).
    let init_mint_ix = initialize_mint2(&token_program_id, &mint_key, &ts_key, None, curve.decimals)
        .map_err(|_| error!(FirepadError::InvalidMint))?;
    anchor_lang::solana_program::program::invoke(&init_mint_ix, &mint_and_program)?;

    // 4) Write name / symbol / uri. Update authority is the token_state PDA, and the
    //    program has no instruction that updates metadata, so it is effectively immutable.
    let init_metadata_ix = spl_token_metadata_interface::instruction::initialize(
        &token_program_id,
        &mint_key,
        &ts_key,
        &mint_key,
        &ts_key,
        params.name.clone(),
        params.symbol.clone(),
        params.uri.clone(),
    );
    anchor_lang::solana_program::program::invoke_signed(
        &init_metadata_ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.token_state.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    // 4b) The curve vault (token_state's ATA) — only possible now that the mint exists.
    anchor_spl::associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        anchor_spl::associated_token::Create {
            payer: ctx.accounts.creator.to_account_info(),
            associated_token: ctx.accounts.curve_vault.to_account_info(),
            authority: ctx.accounts.token_state.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    // 5) Fund the SOL vaults to rent-exemption.
    let vault_rent = ctx.accounts.rent.minimum_balance(0);
    for vault in [
        ctx.accounts.sol_vault.to_account_info(),
        ctx.accounts.creator_vault.to_account_info(),
        ctx.accounts.reward_vault.to_account_info(),
    ] {
        let top_up = vault_rent.saturating_sub(vault.lamports());
        if top_up > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.creator.to_account_info(),
                        to: vault,
                    },
                ),
                top_up,
            )?;
        }
    }

    // 6) Mint the whole supply into the curve vault (minting charges no transfer fee).
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.curve_vault.to_account_info(),
                authority: ctx.accounts.token_state.to_account_info(),
            },
            signer_seeds,
        ),
        curve.token_total_supply,
    )?;

    // 6b) Revoke mint authority: supply is fixed forever.
    set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: ctx.accounts.token_state.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            signer_seeds,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    // 7) Record state (everything not set here starts at zero/false).
    let ts = &mut ctx.accounts.token_state;
    ts.mint = mint_key;
    ts.creator = ctx.accounts.creator.key();
    ts.virtual_sol_reserves = curve.initial_virtual_sol_reserves;
    ts.virtual_token_reserves = curve.initial_virtual_token_reserves;
    ts.real_token_reserves = curve.initial_real_token_reserves;
    ts.token_total_supply = curve.token_total_supply;
    ts.initial_real_token_reserves = curve.initial_real_token_reserves;
    ts.bump = ts_bump;
    ts.sol_vault_bump = ctx.bumps.sol_vault;
    ts.reward_vault_bump = ctx.bumps.reward_vault;
    ts.creator_vault_bump = ctx.bumps.creator_vault;

    msg!("Created token {} ({}) with {}bps transfer fee", params.name, params.symbol, fee_bps);
    Ok(())
}
