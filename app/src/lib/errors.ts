export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("rejected the request")) return "You rejected the wallet request.";
  if (lower.includes("not connected") || lower.includes("wallet is not connected")) return "Connect your wallet first.";
  if (lower.includes("signmessage") || lower.includes("sign message")) return "This wallet does not support message signing.";
  if (lower.includes("withdrawtooearly")) return "This reservation is still in its settlement window.";
  if (lower.includes("notreservationowner")) return "Only the wallet that created this reservation can withdraw it.";
  if (lower.includes("insufficient funds")) return "Your wallet does not have enough devnet SOL for this transaction.";
  return message || "Something went wrong. Please try again.";
}
