use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PatError;

// ───────────────────────── Reservation ─────────────────────────

/// Derived from the clock. Never stored.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ReservationPhase {
    Active,     // now < expires_at
    Expiring,   // expires_at <= now <= settle_deadline
    Releasable, // now > settle_deadline
}

/// The bounded offline spending allowance. Also the escrow: it holds the lamports itself.
/// PDA: ["reservation", owner, reservation_id.to_le_bytes()]
///
/// Lamport invariant (checked by the instruction after every settle):
///   account.lamports >= rent_exempt_min(Reservation)
///                       + (capacity - committed)
///                       + rent_reserve
#[account]
#[derive(InitSpace)]
pub struct Reservation {
    pub owner: Pubkey,         // 32  payer and sole withdrawer
    pub reservation_id: u64,   // 8   never reuse per owner
    pub capacity: u64,         // 8   lamports reserved for payments
    pub committed: u64,        // 8   paid out so far. Invariant: committed <= capacity
    pub rent_reserve: u64,     // 8   lamports set aside to reimburse Payment rent
    pub per_payment_cap: u64,  // 8   max lamports in a single payment
    pub payments_settled: u32, // 4
    pub created_at: i64,       // 8
    pub expires_at: i64,       // 8   end of the offline spending window
    pub settle_deadline: i64,  // 8   expires_at + grace: settle cutoff and earliest withdraw
    pub bump: u8,              // 1
}
// INIT_SPACE = 101, account size = 8 + 101 = 109

impl Reservation {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;

    /// remaining = capacity - committed (derived, never stored)
    pub fn remaining(&self) -> u64 {
        self.capacity.saturating_sub(self.committed)
    }

    pub fn phase(&self, now: i64) -> ReservationPhase {
        if now < self.expires_at {
            ReservationPhase::Active
        } else if now <= self.settle_deadline {
            ReservationPhase::Expiring
        } else {
            ReservationPhase::Releasable
        }
    }

    /// Checks that depend only on reservation state. Rent-reserve and signature
    /// checks belong to the instruction (they need sysvars).
    pub fn check_can_settle(&self, amount: u64, now: i64) -> Result<()> {
        require!(amount > 0, PatError::ZeroAmount);
        require!(now <= self.settle_deadline, PatError::SettleWindowClosed);
        require!(amount <= self.per_payment_cap, PatError::ExceedsPerPaymentCap);
        require!(amount <= self.remaining(), PatError::InsufficientCapacity);
        Ok(())
    }

    /// Applies a payment to the accounting. All-or-nothing: state is untouched on error.
    pub fn commit(&mut self, amount: u64) -> Result<()> {
        let new_committed = self
            .committed
            .checked_add(amount)
            .ok_or(error!(PatError::Overflow))?;
        require!(new_committed <= self.capacity, PatError::InsufficientCapacity);
        let new_count = self
            .payments_settled
            .checked_add(1)
            .ok_or(error!(PatError::Overflow))?;
        self.committed = new_committed;
        self.payments_settled = new_count;
        Ok(())
    }

    pub fn validate_params(
        capacity: u64,
        per_payment_cap: u64,
        expires_at: i64,
        max_payments: u32,
        now: i64,
    ) -> Result<()> {
        require!(capacity > 0, PatError::InvalidCapacity);
        require!(
            per_payment_cap > 0 && per_payment_cap <= capacity,
            PatError::InvalidPerPaymentCap
        );
        require!(expires_at > now, PatError::InvalidReservationWindow);
        require!(
            max_payments > 0 && max_payments <= MAX_PAYMENTS_PER_RESERVATION,
            PatError::InvalidMaxPayments
        );
        Ok(())
    }

    /// rent_reserve = max_payments * rent_exempt_min(Payment::SPACE)
    pub fn rent_reserve_for(max_payments: u32, payment_rent: u64) -> Result<u64> {
        payment_rent
            .checked_mul(max_payments as u64)
            .ok_or(error!(PatError::Overflow))
    }

    /// settle_deadline = expires_at + SETTLE_GRACE_SECS
    pub fn deadline_for(expires_at: i64) -> Result<i64> {
        expires_at
            .checked_add(SETTLE_GRACE_SECS)
            .ok_or(error!(PatError::Overflow))
    }
}

// ───────────────────────── Payment ─────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PaymentStatus {
    Settled,
    // Reversed, // reserved for a future reverse-payment feature
}

/// On-chain record of one settled payment. Existence = CONFIRMED, and it is the replay guard.
/// Outlives the Reservation so a merchant can still prove payment after the payer withdraws.
/// PDA: ["payment", reservation, payment_id]
#[account]
#[derive(InitSpace)]
pub struct Payment {
    pub payment_id: [u8; 32],   // 32
    pub reservation: Pubkey,    // 32
    pub payer: Pubkey,          // 32  duplicated from reservation.owner: the reservation can close
    pub merchant: Pubkey,       // 32
    pub amount: u64,            // 8
    pub status: PaymentStatus,  // 1
    pub intent_created_at: i64, // 8   payer-declared, not verified by the chain
    pub settled_at: i64,        // 8
    pub settled_slot: u64,      // 8
    pub sequence: u32,          // 4   from the intent; enables future equivocation proofs
    pub bump: u8,               // 1
}
// INIT_SPACE = 166, account size = 8 + 166 = 174

impl Payment {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}

// ───────────────────────── PaymentIntent (not an account) ─────────────────────────

/// The signed body carried in the QR. The customer signs `signing_bytes()` (ed25519).
/// The 64-byte signature travels beside it off-chain, not inside it.
///
/// FIELD ORDER IS PART OF THE WIRE FORMAT. Reordering breaks every existing signature
/// and the TypeScript encoder.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub struct PaymentIntent {
    pub version: u8,
    pub cluster: u8,
    pub payment_id: [u8; 32],
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub reservation: Pubkey,
    pub amount: u64,
    pub created_at: i64,
    pub expires_at: i64,        // acceptance deadline (merchant-enforced) and <= reservation.expires_at
    pub sequence: u32,          // monotonic per reservation, assigned by the offline ledger
    pub committed_after: u64,   // payer's claimed running total after this payment
}

impl PaymentIntent {
    /// Serialized body length, excluding the domain tag.
    pub const BODY_LEN: usize = 1 + 1 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 4 + 8; // 166

    /// Exact bytes the customer signs: INTENT_DOMAIN || borsh(self).
    pub fn signing_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(INTENT_DOMAIN.len() + Self::BODY_LEN);
        out.extend_from_slice(INTENT_DOMAIN);
        self.serialize(&mut out)
            .expect("serializing into a Vec cannot fail");
        out
    }

    /// Structural checks that need no clock and no signature.
    pub fn validate_window(&self, reservation: &Reservation) -> Result<()> {
        require!(self.version == INTENT_VERSION, PatError::UnsupportedVersion);
        require!(self.cluster == CLUSTER_ID, PatError::WrongCluster);
        require!(self.amount > 0, PatError::ZeroAmount);
        require!(self.created_at <= self.expires_at, PatError::InvalidIntentWindow);
        require!(
            self.expires_at <= reservation.expires_at,
            PatError::InvalidIntentWindow
        );
        require!(
            self.committed_after >= self.amount && self.committed_after <= reservation.capacity,
            PatError::InvalidLedgerClaim
        );
        Ok(())
    }

    /// Binding checks: checks 2 and 3 of the settle list.
    pub fn check_binding(&self, reservation_key: &Pubkey, reservation: &Reservation) -> Result<()> {
        require_keys_eq!(self.payer, reservation.owner, PatError::PayerMismatch);
        require_keys_eq!(self.reservation, *reservation_key, PatError::ReservationMismatch);
        Ok(())
    }
}

// ───────────────────────── Tests (run without a validator) ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn reservation() -> Reservation {
        Reservation {
            owner: Pubkey::new_unique(),
            reservation_id: 1,
            capacity: 1_000_000_000, // 1 SOL
            committed: 0,
            rent_reserve: 5_000_000,
            per_payment_cap: 800_000_000,
            payments_settled: 0,
            created_at: 1_000,
            expires_at: 1_000 + 24 * 60 * 60,
            settle_deadline: 1_000 + 24 * 60 * 60 + SETTLE_GRACE_SECS,
            bump: 255,
        }
    }

    fn intent(r: &Reservation, reservation_key: Pubkey) -> PaymentIntent {
        PaymentIntent {
            version: INTENT_VERSION,
            cluster: CLUSTER_ID,
            payment_id: [7u8; 32],
            payer: r.owner,
            merchant: Pubkey::new_unique(),
            reservation: reservation_key,
            amount: 250_000_000,
            created_at: 2_000,
            expires_at: 2_000 + 3_600,
            sequence: 0,
            committed_after: 250_000_000,
        }
    }

    #[test]
    fn account_sizes_are_pinned() {
        assert_eq!(Reservation::INIT_SPACE, 101);
        assert_eq!(Reservation::SPACE, 109);
        assert_eq!(Payment::INIT_SPACE, 166);
        assert_eq!(Payment::SPACE, 174);
    }

    #[test]
    fn remaining_is_capacity_minus_committed() {
        let mut r = reservation();
        assert_eq!(r.remaining(), 1_000_000_000);
        r.committed = 400_000_000;
        assert_eq!(r.remaining(), 600_000_000);
    }

    #[test]
    fn phase_boundaries() {
        let r = reservation();
        assert_eq!(r.phase(r.expires_at - 1), ReservationPhase::Active);
        assert_eq!(r.phase(r.expires_at), ReservationPhase::Expiring);
        assert_eq!(r.phase(r.settle_deadline), ReservationPhase::Expiring);
        assert_eq!(r.phase(r.settle_deadline + 1), ReservationPhase::Releasable);
    }

    #[test]
    fn check_can_settle_enforces_window_cap_and_capacity() {
        let mut r = reservation();
        assert!(r.check_can_settle(250_000_000, r.settle_deadline).is_ok());
        assert!(r.check_can_settle(250_000_000, r.settle_deadline + 1).is_err()); // window closed
        assert!(r.check_can_settle(0, 5_000).is_err());                           // zero
        assert!(r.check_can_settle(900_000_000, 5_000).is_err());                 // over per-payment cap
        r.committed = 900_000_000;
        assert!(r.check_can_settle(200_000_000, 5_000).is_err());                 // over remaining
    }

    #[test]
    fn oversubscription_second_payment_is_rejected_and_state_unchanged() {
        // The 0.7 + 0.7 against a 1 SOL reservation case.
        let mut r = reservation();
        assert!(r.commit(700_000_000).is_ok());
        assert!(r.commit(700_000_000).is_err());
        assert_eq!(r.committed, 700_000_000);
        assert_eq!(r.payments_settled, 1);
        assert!(r.commit(300_000_000).is_ok()); // exactly exhausts capacity
        assert_eq!(r.remaining(), 0);
        assert!(r.commit(1).is_err());
    }

    #[test]
    fn commit_never_overflows() {
        let mut r = reservation();
        r.committed = u64::MAX - 1;
        assert!(r.commit(5).is_err());
        assert_eq!(r.committed, u64::MAX - 1);
    }

    #[test]
    fn intent_validation() {
        let r = reservation();
        let key = Pubkey::new_unique();
        let good = intent(&r, key);
        assert!(good.validate_window(&r).is_ok());
        assert!(good.check_binding(&key, &r).is_ok());

        let mut bad = good.clone();
        bad.version = 2;
        assert!(bad.validate_window(&r).is_err());

        let mut bad = good.clone();
        bad.cluster = CLUSTER_ID + 1;
        assert!(bad.validate_window(&r).is_err());

        let mut bad = good.clone();
        bad.expires_at = r.expires_at + 1; // outlives the reservation
        assert!(bad.validate_window(&r).is_err());

        let mut bad = good.clone();
        bad.created_at = bad.expires_at + 1;
        assert!(bad.validate_window(&r).is_err());

        let mut bad = good.clone();
        bad.committed_after = r.capacity + 1; // claims more than capacity
        assert!(bad.validate_window(&r).is_err());

        let mut bad = good.clone();
        bad.committed_after = bad.amount - 1; // running total below this payment
        assert!(bad.validate_window(&r).is_err());

        let mut bad = good.clone();
        bad.payer = Pubkey::new_unique();
        assert!(bad.check_binding(&key, &r).is_err());

        assert!(good.check_binding(&Pubkey::new_unique(), &r).is_err()); // wrong reservation
    }

    #[test]
    fn signing_bytes_layout_is_stable() {
        let r = reservation();
        let i = intent(&r, Pubkey::new_unique());
        let bytes = i.signing_bytes();
        assert_eq!(INTENT_DOMAIN.len(), 13);
        assert_eq!(bytes.len(), 13 + PaymentIntent::BODY_LEN);
        assert_eq!(bytes.len(), 179);
        assert_eq!(&bytes[..13], INTENT_DOMAIN);
        assert_eq!(bytes[13], INTENT_VERSION);
        assert_eq!(bytes[14], CLUSTER_ID);
        assert_eq!(&bytes[15..47], &[7u8; 32]);
    }

    #[test]
    fn intent_borsh_roundtrip() {
        let r = reservation();
        let i = intent(&r, Pubkey::new_unique());
        let mut buf = Vec::new();
        i.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), PaymentIntent::BODY_LEN);
        let back = PaymentIntent::try_from_slice(&buf).unwrap();
        assert_eq!(i, back);
    }

    /// Golden vector for the TypeScript parity test. Run with --nocapture, paste the hex.
    #[test]
    fn print_golden_vector() {
        let i = PaymentIntent {
            version: INTENT_VERSION,
            cluster: CLUSTER_ID,
            payment_id: [1u8; 32],
            payer: Pubkey::new_from_array([2u8; 32]),
            merchant: Pubkey::new_from_array([3u8; 32]),
            reservation: Pubkey::new_from_array([4u8; 32]),
            amount: 250_000_000,
            created_at: 1_700_000_000,
            expires_at: 1_700_003_600,
            sequence: 5,
            committed_after: 750_000_000,
        };
        let hex: String = i.signing_bytes().iter().map(|b| format!("{:02x}", b)).collect();
        println!("GOLDEN_INTENT_HEX={}", hex);
    }
}


#[cfg(test)]
mod reserve_param_tests {
    use super::*;

    fn code(r: Result<()>) -> Option<u32> {
        match r {
            Err(Error::AnchorError(e)) => Some(e.error_code_number),
            _ => None,
        }
    }
    fn c(e: PatError) -> Option<u32> { Some(u32::from(e)) }

    const NOW: i64 = 1_700_000_000;

    #[test]
    fn valid_params_pass() {
        assert!(Reservation::validate_params(1_000, 250, NOW + 86_400, 10, NOW).is_ok());
        // per_payment_cap == capacity is allowed
        assert!(Reservation::validate_params(1_000, 1_000, NOW + 1, 1, NOW).is_ok());
    }

    #[test]
    fn zero_capacity_rejected() {
        assert_eq!(code(Reservation::validate_params(0, 0, NOW + 10, 1, NOW)), c(PatError::InvalidCapacity));
    }

    #[test]
    fn per_payment_cap_bounds() {
        assert_eq!(code(Reservation::validate_params(1_000, 0, NOW + 10, 1, NOW)), c(PatError::InvalidPerPaymentCap));
        assert_eq!(code(Reservation::validate_params(1_000, 1_001, NOW + 10, 1, NOW)), c(PatError::InvalidPerPaymentCap));
    }

    #[test]
    fn expiry_must_be_strictly_future() {
        assert_eq!(code(Reservation::validate_params(1_000, 100, NOW, 1, NOW)), c(PatError::InvalidReservationWindow));
        assert_eq!(code(Reservation::validate_params(1_000, 100, NOW - 1, 1, NOW)), c(PatError::InvalidReservationWindow));
    }

    #[test]
    fn max_payments_bounds() {
        assert_eq!(code(Reservation::validate_params(1_000, 100, NOW + 10, 0, NOW)), c(PatError::InvalidMaxPayments));
        assert_eq!(
            code(Reservation::validate_params(1_000, 100, NOW + 10, MAX_PAYMENTS_PER_RESERVATION + 1, NOW)),
            c(PatError::InvalidMaxPayments)
        );
        assert!(Reservation::validate_params(1_000, 100, NOW + 10, MAX_PAYMENTS_PER_RESERVATION, NOW).is_ok());
    }

    #[test]
    fn rent_reserve_math_and_overflow() {
        assert_eq!(Reservation::rent_reserve_for(10, 1_000).unwrap(), 10_000);
        assert!(Reservation::rent_reserve_for(2, u64::MAX).is_err());
    }

    #[test]
    fn deadline_adds_grace_and_guards_overflow() {
        assert_eq!(Reservation::deadline_for(NOW).unwrap(), NOW + SETTLE_GRACE_SECS);
        assert!(Reservation::deadline_for(i64::MAX).is_err());
    }
}
