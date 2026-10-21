pub mod admin;
pub mod buy;
pub mod claim;
pub mod create_token;
pub mod fees;
pub mod initialize;
pub mod migrate;
pub mod rewards;
pub mod sell;

pub use admin::*;
pub use buy::*;
pub use claim::*;
pub use create_token::*;
pub use fees::*;
pub use initialize::*;
pub use migrate::*;
pub use rewards::*;
pub use sell::*;

use crate::errors::FirepadError;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer as sys_transfer, Transfer as SysTransfer};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{transfer_fee::TransferFeeConfig, BaseStateWithExtensions, StateWithExtensions},
    state::Mint as MintState,
};

/// Token-2022 transfer fee this mint charges on a transfer of `amount` right now.
pub fn transfer_fee_for(mint: &AccountInfo, amount: u64) -> Result<u64> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)?;
    let cfg = state.get_extension::<TransferFeeConfig>()?;
    cfg.calculate_epoch_fee(Clock::get()?.epoch, amount)
        .ok_or_else(|| error!(FirepadError::MathOverflow))
}

/// Pay lamports out of one of our system-owned PDA vaults.
pub fn vault_pay<'info>(
    system_program: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    vault_seeds: &[&[u8]],
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    sys_transfer(
        CpiContext::new_with_signer(
            system_program.clone(),
            SysTransfer { from: vault.clone(), to: to.clone() },
            &[vault_seeds],
        ),
        lamports,
    )
}
