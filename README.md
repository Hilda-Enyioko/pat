# PAT: Primitive Airborne Transaction

**Reserve online. Pay offline. Settle through the merchant.**

PAT is a self-custodial payment protocol on Solana for temporary connectivity loss. A payer locks a bounded spending allowance on-chain while online. Later, with no internet at all, the payer signs a payment authorization against that allowance and hands it to a merchant locally (for example as a QR code). The merchant, who only needs connectivity on their own side, submits it to the PAT program, which verifies the signature and moves funds from the reservation to the merchant.

> **Status: prototype / hackathon project.** Deployed on devnet. Not for real-value use without an independent security review. See [Security model and honest limits](#security-model-and-honest-limits).

| | |
|---|---|
| Program ID (devnet) | `HopC7DPpeyiPiq2Nqyy9WDCRBKduNu3PoqyaN6ACZUhh` |
| Stack | Solana, Rust, Anchor, ed25519 precompile, TypeScript |
| Client | React PWA (in progress) |
| Author | Hilda Enyioko |

---

## The problem

Payments assume the internet is always there. Coverage drops, networks congest, rural and underserved areas have patchy data, and people run out of data at the wrong moment. Today the options at the till are "wait" or "don't pay".

You cannot create an on-chain payment while offline. PAT's answer is to move the hard part earlier in time: create the **bounded offline spending allowance while connected**, then let the offline step be nothing more than a signature.

---

## How it works

```text
   ONLINE (payer)                OFFLINE (payer -> merchant)           ONLINE (merchant)
 ┌──────────────────┐          ┌───────────────────────────┐        ┌───────────────────┐
 │ reserve(capacity)│          │ sign PaymentIntent        │        │ settle(intent)    │
 │ funds locked in  │  ──────► │ (no internet needed)      │ ─────► │ ed25519 verified  │
 │ Reservation PDA  │          │ QR: intent + signature    │   QR   │ funds -> merchant │
 └──────────────────┘          └───────────────────────────┘        └───────────────────┘
```

1. **Reserve (online).** The payer calls `reserve`, which moves `capacity + rent_reserve` lamports into a Reservation PDA. That account is the escrow itself.
2. **Spend (offline).** The payer's wallet checks its local offline ledger, then signs a `PaymentIntent` naming the merchant, amount, reservation and expiry. The payload (166-byte body plus 64-byte signature, 327 characters as JSON/base64) is shown as a QR code.
3. **Accept (merchant, possibly offline).** The merchant verifies the signature and bounds locally and shows **Offline Accepted**. This is a merchant-side trust decision, not a blockchain guarantee.
4. **Settle (merchant online).** The merchant submits one transaction containing an ed25519 precompile instruction followed by PAT's `settle` instruction. The program verifies everything and creates a `Payment` account. **Existence of that account is Confirmed.**

The payer never has to reconnect for the merchant to get paid. The merchant is the bridge to the network.

### Offline Accepted is not Confirmed

| State | Meaning | Who decides |
|---|---|---|
| **Offline Accepted** | Signature valid and intent within bounds, as far as the merchant can check without the chain | Merchant's risk decision |
| **Confirmed** | The `settle` transaction landed and the `Payment` PDA exists | The chain |

PAT never presents an offline payment as blockchain-confirmed before it is.

---

## Architecture

### Accounts

**Reservation** (PDA: `["reservation", owner, reservation_id.to_le_bytes()]`, 109 bytes)
The bounded allowance and the escrow. It holds the lamports itself, with no separate vault. A system-owned vault could not be left with dust below its rent-exempt minimum, and `close = owner` refunds cleanly on withdraw.

**Payment** (PDA: `["payment", reservation, payment_id]`, 174 bytes)
One per settled payment. It is the proof of Confirmed and the replay guard: a second `settle` with the same `payment_id` fails at account `init`. It outlives the Reservation, so a merchant can still prove payment after the payer withdraws.

**PaymentIntent** is not an account. It is the signed message carried in the QR.

### Reservation phases (derived from the clock, never stored)

```text
 Active                  Expiring                       Releasable
 now < expires_at        expires_at <= now <=           now > settle_deadline
                         settle_deadline
 new intents OK          no new intents                 settle rejected
 settle OK               settle OK (already accepted)   owner may withdraw
```

`settle_deadline = expires_at + 30 min grace`. There is deliberately **no early close**: letting the owner shorten the window would let them withdraw before an offline merchant reconnects. Funds stay locked until `settle_deadline`. At the single second `now == settle_deadline`, neither settle-after nor withdraw succeeds, which is intentional and tested.

### Instructions

| Instruction | Who | What it does |
|---|---|---|
| `reserve(reservation_id, capacity, per_payment_cap, expires_at, max_payments)` | Payer | Locks `capacity + rent_reserve`. `rent_reserve = max_payments * rent(Payment)`, which prepays receipt rent and caps receipts per reservation |
| `settle(intent)` | Anyone (merchant or relayer) | Verifies the signed intent and pays the merchant. Funds can only go to `intent.merchant` |
| `withdraw` | Owner only | After `settle_deadline`, closes the Reservation and refunds unspent capacity, unused rent reserve and account rent |

`settle` checks, in order:

1. The ed25519 precompile instruction sits immediately before `settle`, and its pubkey and message bytes match the intent exactly (read from the instructions sysvar, which is pinned to its real address).
2. The signer equals `intent.payer`.
3. `reservation.owner == intent.payer` and `intent.reservation` is the reservation account passed in.
4. The Payment PDA seeds include the reservation.
5. The payment is not already settled (`init` fails if the PDA exists).
6. Window: `now <= settle_deadline`, `intent.expires_at <= reservation.expires_at`, `created_at <= expires_at`, `created_at >= reservation.created_at`, cluster and version match.
7. Capacity: `committed + amount <= capacity`, `amount <= per_payment_cap`, and the rent reserve covers the Payment account.

The settler fronts the Payment account rent and is reimbursed from `rent_reserve`. That is how "the payer pays the rent" works while the payer is offline. In the devnet run the net cost to the relayer is zero.

**Lamport invariant**, checked after `reserve` and after every `settle`:

```text
reservation.lamports >= rent_exempt_min(Reservation) + (capacity - committed) + rent_reserve
```

Tests assert this as an equality after every settle.

### PaymentIntent wire format

Signed bytes are `"PAT-INTENT-v1" (13 bytes) || borsh(PaymentIntent)`, 179 bytes in total. The 64-byte ed25519 signature travels beside it off-chain. **Field order is part of the format.**

| Field | Type | Notes |
|---|---|---|
| version | u8 | currently 1 |
| cluster | u8 | 0 localnet, 1 devnet, 2 mainnet-beta; compared to a constant compiled into the program |
| payment_id | [u8; 32] | random; part of the Payment PDA seeds |
| payer | Pubkey | |
| merchant | Pubkey | |
| reservation | Pubkey | |
| amount | u64 | lamports |
| created_at | i64 | payer-declared |
| expires_at | i64 | acceptance deadline, enforced by the merchant app; must be `<= reservation.expires_at` |
| sequence | u32 | from the offline ledger; stored on Payment, not order-enforced |
| committed_after | u64 | payer's claimed running total; sanity-checked against capacity |

A Rust golden vector and a TypeScript encoder are tested for byte-for-byte parity.

### Offline ledger (client)

The wallet measures `available_offline_balance` and refuses to sign anything above it:

```text
available_offline = capacity - committed_on_chain - sum(pending intents)
```

Rules:

1. **Write-ahead.** The debit is persisted *before* a signature exists.
2. **Pending counts** until resolved.
3. **Credit back only on proof.** A pending intent is dropped only when its Payment PDA exists, or when `now > settle_deadline` with no PDA. Never earlier.
4. **Fail closed.** No initialized ledger (fresh install, restored wallet, second device) means refuse to sign offline.
5. **Reconcile** with a single `getMultipleAccounts` read so committed and receipts come from the same slot.

The signing gate also checks `amount > 0`, `amount <= per_payment_cap`, and `now < expires_at`.

### Payment lifecycle (off-chain, tracked on both devices)

```text
SIGNED ──► OFFLINE_ACCEPTED ──► SETTLING ──► CONFIRMED
   │              │
   └──────────────┴──► EXPIRED (acceptance window or settle_deadline passed)
                  └──► REJECTED (bad signature, duplicate, over capacity, over cap)
```

| State | Where | Meaning |
|---|---|---|
| SIGNED | Customer app | Debited in the local ledger, signature produced |
| OFFLINE_ACCEPTED | Merchant app | Merchant verified locally |
| SETTLING | Merchant app | `settle` transaction submitted |
| CONFIRMED | Both | Payment PDA exists |

The earlier BROADCAST and RESERVED states were retired, because it is the merchant, not the customer, who submits.

---

## Design history and lessons

PAT's design changed substantially during the build. The reasons are as much a part of the project as the final design.

### v0: durable-nonce transactions (spiked, then abandoned)

The first idea was for the customer to sign a normal Solana transaction using a **durable nonce**, so it would stay valid indefinitely, and for the merchant to broadcast it later.

The spike worked: a signed transaction survived more than 7 minutes and landed after an ordinary blockhash would have expired. The spike script is kept in the repo as a working fallback.

### Why it was abandoned: the void attack

A durable-nonce transaction must begin with `nonceAdvance`, signed by the nonce authority at the top level. A PDA cannot sign a top-level transaction, so the authority has to be a keypair, effectively the customer's. After paying offline, the customer could simply advance the nonce and **void the merchant's signed transaction**.

> **Lesson:** a transaction being validly signed does not make the authorization it represents safe to hold offline.

### v1: reservation plus signed PaymentIntent (current)

The offline artifact is now a **signed financial authorization**, not a stale transaction. The merchant builds a fresh transaction later, containing an ed25519 precompile instruction plus `settle`. There is no nonce for the customer to advance. The customer's only way out is `withdraw`, which is blocked until `settle_deadline`.

### Other decisions and their reasons

- **Reservation is the escrow** (no separate vault), for clean refunds and no rent-dust problem.
- **One Payment account per payment**, not a list inside the Reservation, so there is no growing account, the replay guard is a plain `init`, and merchant proof outlives the payer's withdrawal.
- **No early close**, so an offline merchant always has the full grace window.
- **Rent prepaid via `max_payments`**, so receipt spam cannot drain the reservation.
- **Cluster field plus domain tag**, because PDA addresses repeat across clusters. The program cannot read the genesis hash, so a compiled-in constant is the only on-chain option.
- **`created_at >= reservation.created_at`**, so a stale intent cannot be settled against a re-created reservation at the same address.
- **`has_one = owner` on `withdraw`.** The reservation seeds use the stored owner, not the signer, so the seeds alone prove nothing about who is calling. Without `has_one`, anyone could sign and send the refund to themselves via `close = owner`.
- **Time from the chain in scripts.** The program uses `Clock::get()`. A locally timestamped intent from a PC whose clock is a few seconds slow can fail the `created_at` check. A real offline wallet only has its local clock, which is one reason `created_at` is treated as untrusted (see below).

---

## Security model and honest limits

**What the reservation guarantees:** the funds exist, are locked, and cannot be withdrawn by the owner before `settle_deadline`. A valid, in-bounds intent can always be settled in that window. Failures are safe for the chain.

**What it does not guarantee:**

- **Deliberate double-issuance.** A payer holding their own key can sign 0.7 SOL to merchant A and 0.7 SOL to merchant B against a 1 SOL reservation, offline. Whoever settles second is rejected with `InsufficientCapacity`, and **that merchant bears the loss**. The offline ledger only prevents *accidental* overspend (stale UI, retries, reinstall, second device). A modified wallet can bypass it.
- **Backdating.** `created_at` is declared by the payer. Offline merchants must rely on their own clock to reject stale intents.
- **Offline Accepted is a risk decision.** Merchants should apply their own limits to offline acceptance.

**Mitigations in the design:** `per_payment_cap`, short reservation windows, merchant-side offline limits, the honest-wallet ledger, and (planned) equivocation bond-and-slash using the stored `sequence`, plus optionally a hardware-enforced counter.

**Note on the "10% of online balance" idea:** any such rule is a client policy and risk limit only. The security boundary is the actual funds locked in the reservation.

> PAT's wallet tracks an offline balance and refuses to sign payments above it. This prevents accidental overspending. Because the payer holds their own key, a deliberate double-issue by a modified wallet remains possible. PAT bounds the exposure with per-payment caps and reservation limits, and plans equivocation penalties.

Signature verification (the ed25519 precompile plus instructions-sysvar byte matching) is where most bugs live in designs like this. It needs dedicated negative tests (wrong signer, tampered amount, wrong message, precompile not immediately before `settle`) before any real-value use.

---

## Devnet proof

A live end-to-end run on Solana devnet using three distinct parties (funder, customer, merchant), executed by `scripts/e2e-devnet.ts`:

| Step | Result |
|---|---|
| Program | `HopC7DPpeyiPiq2Nqyy9WDCRBKduNu3PoqyaN6ACZUhh` |
| Customer | `DR8bVZfdReYnaKDBLpCFvDJEp323Xu23YzLJBqTQxpbB` |
| Merchant | `AUkgqP48sWMhTBLFiXrHNMroy52iM59LD5rGcW11vR3V` |
| Reserve | 0.1 SOL capacity, reservation `AcygezR7X9hvseyaEftyUaPTvFux6WoVWHNWtuYf9mwJ` |
| Offline signing | 0.02 SOL intent; QR payload 327 chars (166 + 64 raw bytes); ledger available dropped 0.10 to 0.08 SOL before any signature left the device |
| Gate check | Oversized payment refused with `OVER_PER_PAYMENT_CAP` |
| Merchant local verify | State: Offline Accepted |
| Settle tx | `5Co6wqB28nEQsyDoXtqeVkE9uFgBiShZ4wBQ4LbF7jjQ88NJhQTAetctb7e5HZSRgSPNfDTjU4uL4a926qBCGQ9n` |
| **Confirmed** | Payment PDA [`Av2Bd6Qnij7FihcZWU7124djPojSu9yDBuuJxJ5ZCdtA`](https://explorer.solana.com/address/Av2Bd6Qnij7FihcZWU7124djPojSu9yDBuuJxJ5ZCdtA?cluster=devnet), settled slot 506409896 |
| Merchant net | +0.019990 SOL (0.02 SOL minus the transaction fee) |
| Ledger after reconcile | Pending 0, available 0.08 SOL |

---

## Testing

| Layer | What it covers |
|---|---|
| Rust unit tests (`state.rs`, no validator) | Pinned account sizes (101/109 and 166/174), phase boundaries at exact seconds, settle checks, oversubscription (0.7 then 0.7 against 1 SOL rejects the second and leaves state unchanged), overflow safety, intent validation branches, reserve parameter bounds, signing-bytes layout, borsh round-trip, golden vector |
| TypeScript parity test | The TS encoder produces byte-identical output to the Rust golden vector |
| Bankrun tests (`tests/withdraw.bankrun.ts`, in-process, controllable clock) | Withdraw blocked until strictly after `settle_deadline` (including exactly at it), owner-only withdraw, lamport invariant as an equality after reserve and every settle, rejected settle changes nothing, replay of the same `payment_id` rejected, partial-spend refund, Payment records outlive the Reservation, settle rejected after the deadline |
| Devnet e2e script | The full reserve, offline sign, local verify, settle, confirm, reconcile flow shown above |

---

## Repository layout

```text
pat/
├── programs/pat/src/
│   ├── lib.rs               # program entrypoints
│   ├── constants.rs         # seeds, CLUSTER_ID, INTENT_DOMAIN, grace period
│   ├── error.rs             # PatError
│   ├── state.rs             # Reservation, Payment, PaymentIntent (+ unit tests)
│   ├── ed25519.rs           # precompile / instructions-sysvar verification
│   └── instructions/        # reserve.rs, settle.rs, withdraw.rs
├── tests/                   # intent-encoding.ts (parity), withdraw.bankrun.ts
├── scripts/e2e-devnet.ts    # CLI end-to-end on devnet
├── app/                     # React PWA (in progress)
├── Anchor.toml
└── README.md
```

---

## Running it

```bash
# Rust unit tests (no validator)
cargo test -p pat -- --nocapture

# TypeScript byte-parity test
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/intent-encoding.ts

# Build, then time-travel tests in Bankrun
anchor build
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/withdraw.bankrun.ts

# End-to-end on devnet (needs a funded CLI wallet; keys persist in .pat-demo/, git-ignored)
npx ts-node scripts/e2e-devnet.ts
```

Notes: keep the project on the Linux filesystem under WSL2 (building on `/mnt/c` was roughly 10x slower and prevented `solana-test-validator` from starting). The cluster is compiled into the program via `CLUSTER_ID`, so deploying to another cluster means changing that constant and rebuilding.

---

## Roadmap

**Hackathon scope (in progress)**

- [x] Accounts, wire format, golden vector, parity test
- [x] `reserve`, `settle` (ed25519 verification), `withdraw`
- [x] Bankrun time-based and invariant tests
- [x] Devnet deploy and end-to-end CLI run
- [ ] React PWA: wallet adapter, reserve UI, offline ledger in IndexedDB (localForage)
- [ ] Offline signing and QR generation (real-size payload tested)
- [ ] Merchant page: scan QR, verify locally, show Offline Accepted, settle when online
- [ ] Failure-case UX: replayed intent, over cap, over offline balance, expired intent, after `settle_deadline`, wrong cluster
- [ ] Negative signature tests (wrong signer, tampered amount, precompile not adjacent)

**Beyond the hackathon**

- SPL token support (USDC), by adding a mint to the Reservation and a token vault
- Equivocation bond-and-slash using `sequence`
- Hardware-backed offline signer (secure element); P-256 via the secp256r1 precompile, subject to checking its current status
- `close_payment` to return Payment rent after a retention period
- Reverse payments (a `Reversed` status is reserved in the enum)
- Independent security review
- A research write-up of the protocol

---

## Related work and novelty

PAT is not the first offline payment idea, and does not claim to be. Prior and adjacent work includes offline CBDC and e-money designs (online value reservation, offline signed IOUs, later reconciliation), Chaum-style offline eCash, Solana's own support for signing transactions offline and broadcasting later, escrow-plus-signed-voucher payment channels, and recent Solana prototypes such as Mora that lock funds in escrow and settle offline-signed vouchers.

PAT's specific contribution is the combination: a payer pre-funds a generic on-chain reservation, then while fully offline signs a **merchant-specific** authorization against it, which an **online merchant settles directly** on-chain, with a reservation window, per-payment cap, replay guard, oversubscription handling, and a fail-closed offline ledger, packaged for intermittent connectivity. The merchant-online path matters: the payer's phone never needs to reconnect.

---

## Project resources

- Pitch video: *coming soon* (placeholder: `https://example.com/pat-pitch`)
- Live demo: *coming soon* (placeholder: `https://pat-demo.example.com`)
- Demo video: *coming soon* (placeholder: `https://example.com/pat-demo`)

The demo will show: reserving an allowance, going offline, signing a payment, handing the QR to a merchant, the **Offline Accepted** state, the merchant settling on-chain, the **Confirmed** state, and the offline-balance gate refusing an overspend.

---

## About

Built by **Hilda Enyioko**, a backend-leaning software engineer working across fintech, payment integrations and distributed systems (TypeScript, Python, Django, NestJS, PostgreSQL, Redis, Paystack, Interswitch), and PAT is her first Solana project. PAT explores how blockchain payments can stay useful when an assumption they normally depend on, continuous connectivity, temporarily disappears.

> The goal is not to replace online payments. It is to make a temporary loss of connectivity less capable of stopping a payment altogether.
