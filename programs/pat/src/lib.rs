pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use state::*;

declare_id!("HpSkCuHays9S7gAVs45BcU6t2gjjeE6dEdy3TwyqcwB8");

#[program]
pub mod pat {
    // instructions will live here
}
