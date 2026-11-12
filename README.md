# PAT: Primitive Airborne Transaction

~ Dedicated to Patricia Ogugua Enyioko.

**Reserve online. Pay with whatever connectivity you have. Settle on-chain.**

PAT is a self-custodial payment protocol on Solana for temporary or partial connectivity loss. A payer locks a bounded spending allowance on-chain while online. After that, they can pay over **two rails**:

- **QR rail (no connectivity at all).** The payer signs a payment authorization offline and hands it to a merchant locally. The merchant submits it to the PAT program.
- **USSD rail (GSM signal only, no mobile data).** The payer dials a USSD code on any phone, confirms with a PIN, and a gateway settles against a reservation that delegated spending to it.

| | |
|---|---|
| Program ID (devnet) | `FZZBN6jwVzWMKR67rta8MewDZPqG8mRHP5igK6qwN8fT` |
| Stack | Solana, Rust, Anchor, SPL Token, ed25519 precompile, TypeScript |
| Client | React PWA |
| USSD gateway | Node, Express, PostgreSQL, Africa's Talking, deployed on Render |
| Author | [Hilda Enyioko](https://github.com/Hilda-Enyioko) |
| Contributor | [Chukwu Pascal](https://github.com/not-a-vibe-coder) |

---

## The problem

Payments assume the internet is always there. Coverage drops, networks congest, rural and underserved areas have patchy data, and people run out of data at the wrong moment. Today the options at the till are "wait" or "don't pay".

You cannot create an on-chain payment while offline. PAT's answer is to move the hard part earlier in time: create the **bounded spending allowance while connected**, then make the payment step as light as possible. On the QR rail that step is a signature. On the USSD rail it is a menu on a basic phone.

---

## Two rails

| | QR rail | USSD rail |
|---|---|---|
| Payer needs | Nothing at payment time | GSM signal (no mobile data) |
| Authorization | Payer signs a `PaymentIntent` with their own key | PIN, verified by the gateway |
| Who submits `settle` | The merchant, or any relayer | The gateway's keeper (the reservation's delegate) |
| Asset | SOL (lamports) | SPL token (for example USDC) |
| Instructions | `reserve`, `settle`, `withdraw` | `reserve_delegated`, `settle_delegated`, `withdraw_token` |
| Spending window | `expires_at` plus a 30 minute grace period | `expires_at` only, no grace period |
| Custody of funds | Reservation PDA holds the lamports | Vault ATA owned by the Reservation PDA holds the tokens |

The rails are **separated by design**. A reservation is either QR (`delegate = None, mint = None`) or USSD (`delegate = Some, mint = Some`). The program enforces this in both directions: `settle` rejects a delegated reservation, `settle_delegated` rejects a SOL reservation, and `withdraw` rejects a token reservation.

---

## How the QR rail works

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

## How the USSD rail works

```text
 ONLINE (payer, once)             GSM ONLY (payer)                     SERVER
┌─────────────────────┐        ┌──────────────────────┐        ┌────────────────────────────┐
│ reserve_delegated   │        │ dial *384*50549#     │        │ POST /ussd (Africa's       │
│ tokens -> vault     │        │ pick merchant code,  │ ─────► │ Talking) -> verify PIN ->  │
│ delegate = keeper   │        │ amount, PIN          │        │ queue payment (pending)    │
│ enroll phone + PIN  │        └──────────────────────┘        └─────────────┬──────────────┘
└─────────────────────┘                                                      │
                                                                             ▼
        SMS confirmation  ◄──────────  keeper: settle_delegated  ◄──── payments table
                                       vault -> merchant token account
```

1. **Reserve and enroll (online, once).** The payer calls `reserve_delegated` from the PWA, naming the gateway's keeper key as `delegate`. Tokens move into a vault ATA owned by the reservation PDA. The payer then enrolls their phone number and a PIN against that reservation.
2. **Pay (USSD).** The payer dials the service code and enters a merchant code, an amount and their PIN. The gateway checks the PIN (hashed with a server-side pepper, locked out after repeated failures) and queues the payment.
3. **Settle (keeper).** A background keeper claims pending payments and calls `settle_delegated`. The program checks the signer is the reservation's delegate, the merchant's token account belongs to the **registered payout address**, the window, the cap and the capacity, then transfers tokens from the vault, signed by the reservation PDA.
4. **Confirm.** The payer gets an SMS. As on the QR rail, the Payment PDA is the source of truth.

### Merchant registry

Merchants on the USSD rail are identified by a short numeric code that a person can type. An admin registers `code -> payout` once (`init_config`, `register_merchant`). A code can never be overwritten. Funds can only ever go to a token account owned by the registered payout address, so neither the keeper nor a typo can redirect them.

---

## Architecture

### Accounts

**Reservation** (PDA: `["reservation", owner, reservation_id.to_le_bytes()]`, 175 bytes)
The bounded allowance. On the QR rail it also holds the funds as lamports, with no separate vault. A system-owned vault could not be left with dust below its rent-exempt minimum, and `close = owner` refunds cleanly on withdraw. On the USSD rail it holds only the **rent reserve** in lamports. The capacity lives in a vault ATA owned by the reservation PDA. Optional `delegate` and `mint` fields mark the rail.

**Payment** (PDA: `["payment", reservation, payment_id]`, 208 bytes)
One per settled payment. It is the proof of Confirmed and the replay guard: a second settle with the same `payment_id` fails at account `init`. It records the rail (`Qr` or `Ussd`) and, for the USSD rail, the mint. It outlives the Reservation, so a merchant can still prove payment after the payer withdraws.

**Config** (PDA: `["config"]`) and **Merchant** (PDA: `["merchant", code.to_le_bytes()]`)
The admin and the merchant registry for the USSD rail.

**PaymentIntent** is not an account. It is the signed message carried in the QR (QR rail only).

### Reservation phases (derived from the clock, never stored)

```text
 Active                  Expiring                       Releasable
 now < expires_at        expires_at <= now <=           now > settle_deadline
                         settle_deadline
 new intents OK          no new intents                 settle rejected
 settle OK               settle OK (already accepted)   owner may withdraw
```

`settle_deadline = expires_at + 30 min grace`. There is deliberately **no early close**: letting the owner shorten the window would let them withdraw before an offline merchant reconnects. Funds stay locked until `settle_deadline`. At the single second `now == settle_deadline`, neither settle-after nor withdraw succeeds, which is intentional and tested.

The USSD rail has no offline intents, so `settle_delegated` requires `now < expires_at` and gets no grace window. Withdraw timing is the same on both rails.

### Instructions

| Instruction | Rail | Who | What it does |
|---|---|---|---|
| `reserve(reservation_id, capacity, per_payment_cap, expires_at, max_payments)` | QR | Payer | Locks `capacity + rent_reserve` lamports |
| `settle(intent)` | QR | Anyone | Verifies the signed intent and pays the merchant |
| `withdraw` | QR | Owner | After `settle_deadline`, closes the Reservation and refunds everything |
| `reserve_delegated(..., delegate)` | USSD | Payer | Moves tokens into the vault, prepays Payment rent in lamports, records `delegate` and `mint` |
| `settle_delegated(payment_id, amount)` | USSD | Delegate only | Transfers tokens vault to merchant, reimburses the delegate's Payment rent |
| `withdraw_token` | USSD | Owner | After `settle_deadline`, returns unspent tokens, closes the vault and the Reservation |
| `init_config`, `register_merchant(code, payout)` | USSD | Admin | One-time config and the merchant registry |

`rent_reserve = max_payments * rent(Payment)`. It prepays receipt rent and caps receipts per reservation. The settler or delegate fronts the Payment account rent and is reimbursed from `rent_reserve`, which is how "the payer pays the rent" works while the payer is offline.

`settle` checks, in order:

1. The ed25519 precompile instruction sits immediately before `settle`, and its pubkey and message bytes match the intent exactly (read from the instructions sysvar, which is pinned to its real address).
2. The signer equals `intent.payer`.
3. `reservation.owner == intent.payer`, the reservation is not delegated, and `intent.reservation` is the reservation account passed in.
4. The Payment PDA seeds include the reservation.
5. The payment is not already settled (`init` fails if the PDA exists).
6. Window: `now <= settle_deadline`, `intent.expires_at <= reservation.expires_at`, `created_at <= expires_at`, `created_at >= reservation.created_at`, cluster and version match.
7. Capacity: `committed + amount <= capacity`, `amount <= per_payment_cap`, and the rent reserve covers the Payment account.

`settle_delegated` checks:

1. The reservation has a delegate and the signer is that delegate.
2. `now < expires_at`.
3. `amount > 0`, `amount <= per_payment_cap`, `committed + amount <= capacity`.
4. The mint account equals the reservation's mint, and the vault is the reservation's ATA for that mint.
5. The merchant token account is for the same mint and is owned by the registered payout address.
6. The Payment PDA does not already exist, and the rent reserve covers it.

**Invariants**, checked after every state change:

```text
QR rail:    reservation.lamports >= rent_exempt_min(Reservation) + (capacity - committed) + rent_reserve
USSD rail:  vault.amount        >= capacity - committed
            reservation.lamports >= rent_exempt_min(Reservation) + rent_reserve
```

### PaymentIntent wire format (QR rail)

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

### Offline ledger (QR rail client)

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

### Payment lifecycle

**QR rail (tracked on both devices):**

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

**USSD rail (gateway database):**

```text
pending ──► sending ──► settled
   ▲            │
   └────────────┴──► (transient error, retried up to 5 times) ──► failed
```

A job stuck in `sending` after a crash is reset to `pending` on startup. This is safe because the Payment PDA blocks a double settle, and the keeper checks for the PDA before sending.

---

## The USSD gateway

The gateway is a small Node service in `gateway/`.

| Piece | File | Role |
|---|---|---|
| HTTP server | `src/index.ts` | `POST /ussd` (Africa's Talking callback), `POST /enroll` (dev only), `GET /health` |
| USSD menu logic | `src/ussd.ts` | Session text parsing, menu screens, PIN check, queues payments |
| Keeper | `src/keeper.ts` | Claims `pending` payments with `FOR UPDATE SKIP LOCKED`, calls `settle_delegated`, retries transient errors, sends SMS |
| Chain access | `src/chain.ts` | Anchor program client, PDAs, `settleDelegated`, error mapping |
| PIN handling | `src/pin.ts` | Hashing with a server-side pepper, format checks |
| SMS | `src/sms.ts` | Africa's Talking SMS notifications |
| Database | `src/db.ts` | `pg` pool |
| Seed script | `scripts/seed.ts` | Creates a test mint, merchant, reservation and enrolls a phone |

**Environment variables**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `RPC_URL` | Solana RPC. Use a dedicated devnet RPC, not the public endpoint |
| `KEEPER_KEYPAIR_JSON` | Keeper (delegate) keypair as a JSON array. Locally you can use `KEEPER_KEYPAIR=/path/to/file.json` instead |
| `PIN_PEPPER` | Server-side secret mixed into PIN hashes |
| `ENROLL_TOKEN` | Shared secret for the dev-only `/enroll` endpoint |
| `IDL_PATH` | Optional. Defaults to `./idl/pat.json`, then `../target/idl/pat.json` |
| `PGSSL` | Set to `off` to disable TLS to Postgres |
| Africa's Talking credentials | Used by `sms.ts` |

**Operational notes**

- Run **exactly one** gateway instance. The keeper's startup reset assumes it.
- The keeper wallet needs devnet SOL. It fronts Payment rent (reimbursed) and the merchant's token account rent the first time it pays that merchant (not reimbursed).
- After every program rebuild, copy `target/idl/pat.json` to `gateway/idl/pat.json`. A stale IDL sends the wrong accounts to the program.
- Render's free tier sleeps when idle, which stops the keeper and times out USSD callbacks. Use a paid instance.

---

## Design history and lessons

PAT's design changed substantially during the build. The reasons are as much a part of the project as the final design.

### v0: durable-nonce transactions (spiked, then abandoned)

The first idea was for the customer to sign a normal Solana transaction using a **durable nonce**, so it would stay valid indefinitely, and for the merchant to broadcast it later.

The spike worked: a signed transaction survived more than 7 minutes and landed after an ordinary blockhash would have expired. The spike script is kept in the repo as a working fallback.

### Why it was abandoned: the void attack

A durable-nonce transaction must begin with `nonceAdvance`, signed by the nonce authority at the top level. A PDA cannot sign a top-level transaction, so the authority has to be a keypair, effectively the customer's. After paying offline, the customer could simply advance the nonce and **void the merchant's signed transaction**.

> **Lesson:** a transaction being validly signed does not make the authorization it represents safe to hold offline.

### v1: reservation plus signed PaymentIntent (QR rail)

The offline artifact is now a **signed financial authorization**, not a stale transaction. The merchant builds a fresh transaction later, containing an ed25519 precompile instruction plus `settle`. There is no nonce for the customer to advance. The customer's only way out is `withdraw`, which is blocked until `settle_deadline`.

### v2: a delegated USSD rail with SPL tokens

The QR rail still needs the payer to own a smartphone with the PWA. v2 extends the same reserve-then-spend idea to anyone with a GSM phone.

- **Delegate on the Reservation.** The payer cannot sign anything over USSD, so the reservation names a delegate (the gateway keeper) that may settle on their behalf, within the reservation's hard limits.
- **Merchant registry instead of free-form recipients.** A typed numeric code resolves to one registered payout address, so the delegate has no power to pay arbitrary addresses.
- **Separate reservations per rail.** One reservation serves one rail, so the two trust models never mix. The program rejects cross-rail use in both directions.
- **SPL tokens on the USSD rail.** Amounts on this rail are token units, held in a vault ATA owned by the reservation PDA. Payment rent stays in lamports, prepaid through `rent_reserve`.
- **No grace window on this rail.** Grace exists for offline intents that a merchant may hold. USSD payments are live, so `expires_at` is a hard stop.
- **A mismatch we hit and fixed.** `reserve_delegated` and `withdraw_token` had been converted to SPL while `settle_delegated` was still the SOL version, so tokens would have sat in the vault with no way to pay them out. The IDL instruction list exposed it. Lesson: diff the generated IDL against what clients send before you deploy.

### Other decisions and their reasons

- **Reservation is the escrow on the QR rail** (no separate vault), for clean refunds and no rent-dust problem.
- **One Payment account per payment**, not a list inside the Reservation, so there is no growing account, the replay guard is a plain `init`, and merchant proof outlives the payer's withdrawal.
- **No early close**, so an offline merchant always has the full grace window.
- **Rent prepaid via `max_payments`**, so receipt spam cannot drain the reservation.
- **Cluster field plus domain tag**, because PDA addresses repeat across clusters. The program cannot read the genesis hash, so a compiled-in constant is the only on-chain option.
- **`created_at >= reservation.created_at`**, so a stale intent cannot be settled against a re-created reservation at the same address.
- **`has_one = owner` on `withdraw` and `withdraw_token`.** The reservation seeds use the stored owner, not the signer, so the seeds alone prove nothing about who is calling. Without `has_one`, anyone could sign and send the refund to themselves via `close = owner`.
- **Time from the chain in scripts.** The program uses `Clock::get()`. A locally timestamped intent from a PC whose clock is a few seconds slow can fail the `created_at` check. A real offline wallet only has its local clock, which is one reason `created_at` is treated as untrusted (see below).

---

## Security model and honest limits

### QR rail

**What the reservation guarantees:** the funds exist, are locked, and cannot be withdrawn by the owner before `settle_deadline`. A valid, in-bounds intent can always be settled in that window. Failures are safe for the chain.

**What it does not guarantee:**

- **Deliberate double-issuance.** A payer holding their own key can sign 0.7 SOL to merchant A and 0.7 SOL to merchant B against a 1 SOL reservation, offline. Whoever settles second is rejected with `InsufficientCapacity`, and **that merchant bears the loss**. The offline ledger only prevents *accidental* overspend (stale UI, retries, reinstall, second device). A modified wallet can bypass it.
- **Backdating.** `created_at` is declared by the payer. Offline merchants must rely on their own clock to reject stale intents.
- **Offline Accepted is a risk decision.** Merchants should apply their own limits to offline acceptance.

**Mitigations in the design:** `per_payment_cap`, short reservation windows, merchant-side offline limits, the honest-wallet ledger, and (planned) equivocation bond-and-slash using the stored `sequence`, plus optionally a hardware-enforced counter.

**Note on the "10% of online balance" idea:** any such rule is a client policy and risk limit only. The security boundary is the actual funds locked in the reservation.

> PAT's wallet tracks an offline balance and refuses to sign payments above it. This prevents accidental overspending. Because the payer holds their own key, a deliberate double-issue by a modified wallet remains possible. PAT bounds the exposure with per-payment caps and reservation limits, and plans equivocation penalties.

### USSD rail

**What the program guarantees.** The delegate can only: settle before `expires_at`, within `per_payment_cap` and the remaining capacity, to a token account owned by a registered merchant payout, for the reservation's mint. It cannot withdraw, cannot change the delegate, and cannot reuse a `payment_id`. The owner cannot be the delegate.

**What it does not guarantee:**

- **The gateway is a trusted party.** PIN verification happens off-chain. A compromised keeper key or gateway could settle payments the payer never authorized, up to the reservation's capacity, to registered merchants. This is the price of letting a basic phone spend. The on-chain limits bound the loss, and the payer chooses the capacity.
- **No early revoke.** The payer cannot cancel a delegated reservation before `settle_deadline`. A shorter `expires_at` is the current control.
- **USSD and SIM risks.** USSD sessions pass through the operator and aggregator, and a SIM swap transfers the phone number. The PIN, lockout and low per-payment cap reduce exposure, but they are not equivalent to a signature from a key the user holds.
- **Dev-only enrollment.** `/enroll` is protected by a shared token. It is a development shortcut, to be replaced by wallet-signed proof of ownership plus SMS OTP.

Signature verification (the ed25519 precompile plus instructions-sysvar byte matching) is where most bugs live in designs like this. It needs dedicated negative tests (wrong signer, tampered amount, wrong message, precompile not immediately before `settle`) before any real-value use.

---

## Devnet proof

### QR rail (earlier deployment, program `HopC7DPpeyiPiq2Nqyy9WDCRBKduNu3PoqyaN6ACZUhh`)

A live end-to-end run on Solana devnet using three distinct parties (funder, customer, merchant), executed by `scripts/e2e-devnet.ts`:

| Step | Result |
|---|---|
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

### USSD rail (program `FZZBN6jwVzWMKR67rta8MewDZPqG8mRHP5igK6qwN8fT`)

Run through the Africa's Talking sandbox simulator (service code `*384*50549#`) against the gateway deployed on Render:

| Step | Result |
|---|---|
| Reservation | `<paste reservation address>` |
| Mint | `<paste mint address>` |
| Merchant code and payout | `<code>` / `<payout address>` |
| USSD payment | `<amount and token symbol>` dialed from the simulator |
| Settle tx | `<paste signature>` |
| **Confirmed** | Payment PDA `<paste address>` ([explorer](https://explorer.solana.com/?cluster=devnet)) |
| SMS | Confirmation received in the simulator inbox |

---

## Testing

| Layer | What it covers |
|---|---|
| Rust unit tests (`state.rs`, no validator) | Pinned account sizes, phase boundaries at exact seconds, settle checks, oversubscription (0.7 then 0.7 against 1 SOL rejects the second and leaves state unchanged), overflow safety, intent validation branches, reserve parameter bounds, signing-bytes layout, borsh round-trip, golden vector |
| TypeScript parity test | The TS encoder produces byte-identical output to the Rust golden vector |
| Rust integration tests, QR rail (`programs/pat/tests/integration.rs`, LiteSVM) | Reserve, settle, withdraw, replay, oversubscription, per-payment cap, rent reserve exhaustion, deadline boundaries, wrong merchant, wrong payer, forged and tampered intents, missing signature instruction, wrong cluster and version |
| Rust integration tests, USSD rail (`programs/pat/tests/token_rail.rs`, LiteSVM) | Token vault funding, delegated settle, non-delegate and owner rejected, cap, zero amount, over-capacity, unregistered merchant, wrong payout owner, wrong mint, double settle, rent reserve exhaustion, no grace window at expiry, rail separation in both directions, `withdraw_token` timing, owner-only withdraw and partial refund, merchant registry admin rules |
| TypeScript tests (Anchor, local validator or devnet) | `reserve`, `settle` and the SPL delegated rail (`spl-delegated.ts`) |
| Bankrun tests (`withdraw.bankrun.ts`, controllable clock) | Withdraw blocked until strictly after `settle_deadline` (including exactly at it), owner-only withdraw, lamport invariant as an equality after every settle, replay rejected, Payment records outlive the Reservation |
| Devnet e2e | QR flow via `scripts/e2e-devnet.ts`; USSD flow via the gateway `seed` script and the Africa's Talking simulator |

---

## Repository layout

```text
pat/
├── programs/pat/
│   ├── src/
│   │   ├── lib.rs                  # program entrypoints
│   │   ├── constants.rs            # seeds, CLUSTER_ID, INTENT_DOMAIN, grace period
│   │   ├── error.rs                # PatError
│   │   ├── events.rs               # ReservationCreated, PaymentSettled, withdrawals, MerchantRegistered
│   │   ├── state.rs                # Reservation, Payment, PaymentIntent, Config, Merchant
│   │   ├── ed25519.rs              # precompile / instructions-sysvar verification
│   │   └── instructions/
│   │       ├── reserve.rs          # QR rail
│   │       ├── settle.rs           # QR rail
│   │       ├── withdraw.rs         # QR rail
│   │       ├── reserve_delegated.rs   # USSD rail
│   │       ├── settle_delegated.rs    # USSD rail
│   │       ├── withdraw_token.rs      # USSD rail
│   │       ├── init_config.rs         # registry
│   │       └── register_merchant.rs   # registry
│   └── tests/                      # integration.rs, token_rail.rs, TS tests
├── gateway/                        # USSD gateway (Node, Express, Postgres)
│   ├── src/                        # index, config, chain, keeper, ussd, sms, pin, db
│   ├── scripts/seed.ts
│   └── idl/pat.json                # copy of target/idl/pat.json, refresh after each build
├── tests/                          # intent-encoding.ts (parity), withdraw.bankrun.ts
├── scripts/e2e-devnet.ts           # CLI end-to-end on devnet (QR rail)
├── app/                            # React PWA
├── Anchor.toml
└── README.md
```

---

## Running it

```bash
# Rust unit and integration tests (build first: the tests load target/deploy/pat.so)
anchor build
cargo test -p pat -- --nocapture

# TypeScript byte-parity test
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/intent-encoding.ts

# Time-travel tests in Bankrun
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/withdraw.bankrun.ts

# TypeScript program tests on a local validator
# (set cluster = "localnet" under [provider] in Anchor.toml first)
anchor test

# QR flow end-to-end on devnet (needs a funded CLI wallet; keys persist in .pat-demo/, git-ignored)
npx ts-node scripts/e2e-devnet.ts
```

### Deploying the program to devnet

```bash
anchor build
ls -l target/deploy/pat.so      # if larger than the deployed size, extend first:
solana program extend <PROGRAM_ID> <extra_bytes> --url <rpc>
anchor upgrade target/deploy/pat.so --program-id <PROGRAM_ID> --provider.cluster <rpc>
cp target/idl/pat.json gateway/idl/pat.json
```

### Running the gateway

```bash
cd gateway
npm install
cp .env.example .env       # fill in the variables listed above
npm start                  # serves POST /ussd, POST /enroll, GET /health
npm run seed               # creates a test mint, merchant and reservation, then enrolls a phone
```

To deploy on Render: create a PostgreSQL database, apply the schema (`enrollments`, `payments`), create a web service with root directory `gateway`, build command `npm install`, start command `npm start`, health check path `/health`, and set the environment variables above. Point the Africa's Talking USSD callback at `https://<service>.onrender.com/ussd`.

Notes: keep the project on the Linux filesystem under WSL2 (building on `/mnt/c` was roughly 10x slower and prevented `solana-test-validator` from starting). The cluster is compiled into the program via `CLUSTER_ID`, so deploying to another cluster means changing that constant and rebuilding.

---

## Roadmap

**Done**

- [x] Accounts, wire format, golden vector, parity test
- [x] QR rail: `reserve`, `settle` (ed25519 verification), `withdraw`
- [x] Bankrun time-based and invariant tests
- [x] QR rail devnet deploy and end-to-end CLI run
- [x] React PWA for the QR rail, live at [pat-sol.vercel.app](https://pat-sol.vercel.app)
- [x] USSD rail: delegate, merchant registry, SPL token vault, `settle_delegated`, `withdraw_token`
- [x] USSD gateway with keeper, PIN lockout and SMS confirmations, deployed on Render
- [x] End-to-end run through the Africa's Talking sandbox simulator

**Next**

- [ ] PWA: create an SPL delegated reservation and enroll a phone from the browser
- [ ] PWA: `withdraw_token` button in the Ledger view
- [ ] Replace dev-only `/enroll` with wallet-signed proof of ownership plus SMS OTP
- [ ] Gateway hardening: authenticate the Africa's Talking callback, rate limiting, keeper balance alerts
- [ ] Negative signature tests (wrong signer, tampered amount, precompile not adjacent)
- [ ] Failure-case UX: replayed intent, over cap, over offline balance, expired intent, after `settle_deadline`, wrong cluster
- [ ] Early revoke or shorter-lived delegation for USSD reservations

**Future goals**

- Mobile application, launched on dApp stores
- Published research work (target: IEEE ICBC)
- Developer SDK (intent signing, reserve, settle, gateway API)
- Refine edge cases and improve platform stability
- Equivocation bond-and-slash using `sequence`
- Hardware-backed offline signer (secure element); P-256 via the secp256r1 precompile, subject to checking its current status
- `close_payment` to return Payment rent after a retention period
- Reverse payments (a `Reversed` status is reserved in the enum)
- SPL token support on the QR rail
- Independent security review

---

## Related work and novelty

PAT is not the first offline payment idea, and does not claim to be. Prior and adjacent work includes offline CBDC and e-money designs (online value reservation, offline signed IOUs, later reconciliation), Chaum-style offline eCash, Solana's own support for signing transactions offline and broadcasting later, escrow-plus-signed-voucher payment channels, and recent Solana prototypes such as Mora that lock funds in escrow and settle offline-signed vouchers.

PAT's specific contribution is the combination: a payer pre-funds a generic on-chain reservation, then pays through whichever channel the moment allows. While fully offline, the payer signs a **merchant-specific** authorization that an **online merchant settles directly** on-chain, with a reservation window, per-payment cap, replay guard, oversubscription handling, and a fail-closed offline ledger. With only GSM signal, a **delegate-based USSD rail** settles against the same reservation model, bounded by on-chain limits and a merchant registry. The merchant-online path and the USSD path both mean the payer's phone never needs mobile data at payment time.

---

## Contributing

PAT is intended to grow into a research paper and a full project, and outside work is welcome. Useful tracks:

| Track | Examples |
|---|---|
| Threat model and security | Attack analysis for both rails, fuzzing, property-based tests, an audit pass over `settle` and `settle_delegated` |
| Evaluation | Settlement latency, success rate under lossy networks, cost per payment, USSD session timing |
| Formal properties | Model-checking `committed <= capacity` and the vault and lamport invariants |
| Field study | Usability testing with real users on feature phones |
| SDK and mobile | TypeScript SDK, React Native or dApp store build |
| Stability | Chaos tests for the keeper (crash mid-settle, RPC drops), idempotency and retry cases |

Open an issue to claim a track before starting. If you contribute to the research paper, contribution and authorship expectations are agreed in writing up front.

---

## Project resources

- Live app: [pat-sol](https://pat-sol.vercel.app)
- Devnet USSD sandbox: service code `*384*50549#` (Africa's Talking sandbox)

The demo shows: reserving an allowance, going offline, signing a payment, handing the QR to a merchant, the **Offline Accepted** state, the merchant settling on-chain, the **Confirmed** state, and the offline-balance gate refusing an overspend. It then shows the USSD rail: enrolling a phone, paying from the simulator, the keeper settling, and the SMS confirmation.

---

## About

Built by **Hilda Enyioko**, a backend-leaning software engineer working across fintech, payment integrations and distributed systems (TypeScript, Python, Django, NestJS, PostgreSQL, Redis, Paystack, Interswitch), and PAT is her first Solana project. PAT explores how blockchain payments can stay useful when an assumption they normally depend on, continuous connectivity, temporarily disappears.

> The goal is not to replace online payments. It is to make a temporary loss of connectivity less capable of stopping a payment altogether.
