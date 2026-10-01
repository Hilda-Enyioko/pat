use anchor_lang::prelude::*;
use solana_instructions_sysvar::{
    load_current_index_checked,
    load_instruction_at_checked,
};
use solana_sdk_ids::ed25519_program;

use crate::error::PatError;

/// Ed25519 precompile instruction data layout:
///   [0]    num_signatures (u8)
///   [1]    padding
///   [2..16] Ed25519SignatureOffsets, seven u16 LE fields:
///           signature_offset, signature_ix_index,
///           public_key_offset, public_key_ix_index,
///           message_offset, message_size, message_ix_index
const OFFSETS_START: usize = 2;
const HEADER_LEN: usize = 16;
const SELF_IX: u16 = u16::MAX;
const PUBKEY_LEN: usize = 32;
const SIG_LEN: usize = 64;

fn u16_at(data: &[u8], at: usize) -> Result<u16> {
    let b = data
        .get(at..at + 2)
        .ok_or(error!(PatError::InvalidSignature))?;
    Ok(u16::from_le_bytes([b[0], b[1]]))
}

fn slice_at(data: &[u8], off: usize, len: usize) -> Result<&[u8]> {
    let end = off.checked_add(len).ok_or(error!(PatError::InvalidSignature))?;
    data.get(off..end).ok_or(error!(PatError::InvalidSignature))
}

/// Pure check of the precompile instruction's data. The runtime has already
/// verified the signature; here we confirm WHAT it verified.
pub fn check_ed25519_ix_data(
    data: &[u8],
    expected_signer: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    require!(data.len() >= HEADER_LEN, PatError::InvalidSignature);
    // Exactly one signature, so no extra unverified payloads.
    require!(data[0] == 1, PatError::InvalidSignature);

    let sig_off = u16_at(data, OFFSETS_START)? as usize;
    let sig_ix = u16_at(data, OFFSETS_START + 2)?;
    let pk_off = u16_at(data, OFFSETS_START + 4)? as usize;
    let pk_ix = u16_at(data, OFFSETS_START + 6)?;
    let msg_off = u16_at(data, OFFSETS_START + 8)? as usize;
    let msg_size = u16_at(data, OFFSETS_START + 10)? as usize;
    let msg_ix = u16_at(data, OFFSETS_START + 12)?;

    // Everything must live inside THIS instruction's own data.
    require!(
        sig_ix == SELF_IX && pk_ix == SELF_IX && msg_ix == SELF_IX,
        PatError::InvalidSignature
    );

    // Signature bytes must be in bounds (the runtime checked this too).
    slice_at(data, sig_off, SIG_LEN)?;

    let pubkey = slice_at(data, pk_off, PUBKEY_LEN)?;
    let message = slice_at(data, msg_off, msg_size)?;

    require!(pubkey == expected_signer.as_ref(), PatError::InvalidSignature);
    require!(message == expected_message, PatError::InvalidSignature);
    Ok(())
}

/// Loads the instruction immediately before the current one and checks it is an
/// ed25519 precompile instruction that verified `expected_message` for `expected_signer`.
pub fn verify_ed25519_intent(
    ix_sysvar: &AccountInfo,
    expected_signer: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current = load_current_index_checked(ix_sysvar)? as usize;
    require!(current > 0, PatError::InvalidSignature);

    // Must be called as a top-level instruction of this program (not via CPI).
    let me = load_instruction_at_checked(current, ix_sysvar)?;
    require_keys_eq!(me.program_id, crate::ID, PatError::InvalidSignature);

    // The precompile instruction must sit IMMEDIATELY before settle.
    let ed = load_instruction_at_checked(current - 1, ix_sysvar)?;
    require_keys_eq!(ed.program_id, ed25519_program::ID, PatError::InvalidSignature);

    check_ed25519_ix_data(&ed.data, expected_signer, expected_message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(r: Result<()>) -> Option<u32> {
        match r {
            Err(Error::AnchorError(e)) => Some(e.error_code_number),
            _ => None,
        }
    }
    const INVALID_SIG: Option<u32> = Some(PatError::InvalidSignature as u32 + 6000);

    /// Canonical layout: header(16) | pubkey(32) | signature(64) | message
    fn build(pk: &[u8; 32], sig: &[u8; 64], msg: &[u8], ix_idx: [u16; 3]) -> Vec<u8> {
        let (pk_off, sig_off, msg_off) = (16u16, 48u16, 112u16);
        let mut d = vec![1u8, 0u8];
        d.extend(sig_off.to_le_bytes());
        d.extend(ix_idx[0].to_le_bytes());
        d.extend(pk_off.to_le_bytes());
        d.extend(ix_idx[1].to_le_bytes());
        d.extend(msg_off.to_le_bytes());
        d.extend((msg.len() as u16).to_le_bytes());
        d.extend(ix_idx[2].to_le_bytes());
        d.extend(pk);
        d.extend(sig);
        d.extend(msg);
        d
    }

    fn signer() -> Pubkey { Pubkey::new_from_array([7u8; 32]) }
    const MSG: &[u8] = b"PAT-INTENT-v1-test-message";

    #[test]
    fn accepts_canonical_layout() {
        let d = build(&[7u8; 32], &[9u8; 64], MSG, [SELF_IX; 3]);
        assert!(check_ed25519_ix_data(&d, &signer(), MSG).is_ok());
    }

    #[test]
    fn rejects_wrong_signer() {
        let d = build(&[8u8; 32], &[9u8; 64], MSG, [SELF_IX; 3]);
        assert_eq!(code(check_ed25519_ix_data(&d, &signer(), MSG)), INVALID_SIG);
    }

    #[test]
    fn rejects_different_message() {
        let d = build(&[7u8; 32], &[9u8; 64], b"another message entirely!!", [SELF_IX; 3]);
        assert_eq!(code(check_ed25519_ix_data(&d, &signer(), MSG)), INVALID_SIG);
    }

    #[test]
    fn rejects_non_self_referencing_indices() {
        for bad in [[0, SELF_IX, SELF_IX], [SELF_IX, 0, SELF_IX], [SELF_IX, SELF_IX, 0]] {
            let d = build(&[7u8; 32], &[9u8; 64], MSG, bad);
            assert_eq!(code(check_ed25519_ix_data(&d, &signer(), MSG)), INVALID_SIG);
        }
    }

    #[test]
    fn rejects_multiple_signatures() {
        let mut d = build(&[7u8; 32], &[9u8; 64], MSG, [SELF_IX; 3]);
        d[0] = 2;
        assert_eq!(code(check_ed25519_ix_data(&d, &signer(), MSG)), INVALID_SIG);
    }

    #[test]
    fn rejects_truncated_and_out_of_bounds() {
        let d = build(&[7u8; 32], &[9u8; 64], MSG, [SELF_IX; 3]);
        assert_eq!(code(check_ed25519_ix_data(&d[..10], &signer(), MSG)), INVALID_SIG);
        // Cut the message short so message_size points past the end.
        assert_eq!(code(check_ed25519_ix_data(&d[..d.len() - 3], &signer(), MSG)), INVALID_SIG);
    }
}
