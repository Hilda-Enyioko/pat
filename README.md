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

Merchants on the USSD rail are identified by a short numeric code that a person can type. An admin registers `code -> payout` once (`init_config`, `register_merchant`). A code can never be overwritten. Funds can only ever go to a token account owned by the registered
