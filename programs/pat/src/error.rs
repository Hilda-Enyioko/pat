use anchor_lang::prelude::*;

#[error_code]
pub enum PatError {
    #[msg("Invalid or missing ed25519 signature instruction")]
    InvalidSignature,
    #[msg("Signer is not the reservation owner")]
    PayerMismatch,
    #[msg("Intent does not reference this reservation")]
    ReservationMismatch,
    #[msg("Intent is for a different cluster")]
    WrongCluster,
    #[msg("Unsupported intent version")]
    UnsupportedVersion,
    #[msg("Intent expiry is invalid or outlives the reservation")]
    InvalidIntentWindow,
    #[msg("Intent's ledger claim is inconsistent with the reservation")]
    InvalidLedgerClaim,
    #[msg("Settlement window has closed")]
    SettleWindowClosed,
    #[msg("Amount exceeds per-payment cap")]
    ExceedsPerPaymentCap,
    #[msg("Insufficient remaining reservation capacity")]
    InsufficientCapacity,
    #[msg("Rent reserve exhausted")]
    RentReserveExhausted,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Cannot withdraw before settle deadline")]
    WithdrawTooEarly,
    #[msg("Arithmetic overflow")]
    Overflow,

    // -- Reserve Errors
    #[msg("Capacity must be greater than zero")]
    InvalidCapacity,
    #[msg("Per-payment cap must be > 0 and <= capacity")]
    InvalidPerPaymentCap,
    #[msg("Reservation expiry must be in the future")]
    InvalidReservationWindow,
    #[msg("max_payments must be between 1 and the program limit")]
    InvalidMaxPayments,
    #[msg("Reservation lamport invariant violated")]
    LamportInvariantBroken,
    #[msg("Merchant account does not match the intent")]
    MerchantMismatch,
}