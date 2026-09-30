# PAT

## Primitive Airborne Transaction

**Reserve while connected. Spend while disconnected. Settle when reconnected.**

PAT is a self-custodial payment protocol built on Solana that explores how users can make merchant payments during temporary connectivity loss without giving up control of their funds.

Instead of attempting to create an on-chain payment while completely offline, PAT establishes a **bounded offline spending allowance while the user is online**. When connectivity is lost, the user can spend from that reserved allowance, transfer the signed payment locally, and allow the transaction to settle on Solana once connectivity returns.

---

## The Problem

Digital payments assume that the internet is always available.

But network connectivity can disappear at exactly the moment a payment needs to happen.

A customer may be:

* In an area with poor network coverage
* Experiencing a temporary network outage
* In a crowded location where cellular networks are congested
* Shopping in a rural or underserved area
* Temporarily without mobile data

Normally, the options are simple:

> **Wait for connectivity or don't complete the payment.**

PAT explores a different approach.

---

## How PAT Works

PAT separates **payment authorization** from **blockchain settlement**.

### 1. Reserve

While online, the user establishes a bounded offline spending allowance.

For example:

```text
Wallet Balance:          10 SOL
Offline Spending Limit:  1 SOL
Reserved Allowance:      1 SOL
```

The allowance is secured on-chain before the user goes offline.

### 2. Go Offline

The user loses internet connectivity.

Their wallet and PAT client can still access the previously established offline spending capacity.

### 3. Spend

The user creates and signs a payment from the reserved allowance.

The signed transaction/payment data can be transferred to the merchant locally, for example through a QR code.

```text
Customer
   │
   │ Signed payment
   ▼
  QR Code
   │
   ▼
Merchant
```

The merchant can verify that the payment belongs to the user's authorized offline spending capacity.

### 4. Reconnect

When internet connectivity returns, PAT automatically submits the pending transaction to Solana.

```text
Offline
   │
   ▼
Signed
   │
   ▼
Reserved
   │
   ▼
Accepted Offline
   │
   │ Network returns
   ▼
Broadcast
   │
   ▼
Confirmed
```

### 5. Settle

The transaction is finally broadcast and confirmed on-chain.

The merchant can distinguish between:

**Offline Accepted**

> The payment has been authorized against the user's reserved offline allowance.

and:

**Confirmed**

> The payment has been settled on Solana.

This distinction prevents PAT from claiming that an offline payment is already blockchain-confirmed when it is not.

---

## Why PAT?

PAT is built around a simple idea:

> **Connectivity should not have to determine whether a payment can happen.**

The protocol explores a middle ground between two extremes:

**Traditional online payment**

```text
Create → Sign → Broadcast → Confirm
                  ↑
              Requires internet
```

**PAT**

```text
Reserve → Sign → Transfer → [Offline]
                              │
                         Connectivity
                              │
                              ▼
                         Broadcast
                              │
                              ▼
                           Confirm
```

The key primitive is the **bounded offline spending allowance**.

The user does not receive unlimited permission to spend while offline. Their offline spending capacity is constrained by funds that were previously reserved on-chain.

---

## Core Architecture

PAT consists of three primary components.

### On-chain Program

Built with **Anchor and Rust**, the Solana program manages the user's offline spending allowance and reservation state.

The reservation acts as a spending boundary that limits how much value can be committed through the offline payment flow.

### Client-side Queue

The React PWA maintains pending payments locally using browser storage.

When a payment is created offline, the client stores the required transaction data and tracks its state until connectivity becomes available.

### Settlement State Machine

PAT exposes the lifecycle of each payment:

```text
SIGNED
   ↓
RESERVED
   ↓
OFFLINE_ACCEPTED
   ↓
BROADCAST
   ↓
CONFIRMED
```

This allows both the application and merchant interface to clearly communicate where a payment currently stands.

---

## Offline Payment Example

Suppose a user has:

```text
Wallet balance:       10 SOL
Offline allowance:     1 SOL
```

The user goes offline.

They purchase something worth:

```text
0.25 SOL
```

PAT can commit that payment against the previously reserved allowance.

The remaining offline capacity becomes:

```text
1.00 SOL
-0.25 SOL
─────────
0.75 SOL
```

The merchant receives the payment locally and sees:

> **Payment accepted offline**

Once the user reconnects, PAT broadcasts the transaction and the merchant eventually sees:

> **Payment confirmed**

---

## Security Model

PAT is designed around **bounded trust rather than unlimited offline spending**.

The offline allowance provides a predefined spending boundary.

This means the system does not simply rely on:

> "The user says they will pay later."

Instead, PAT attempts to establish spending capacity before connectivity is lost and then constrain offline payments to that capacity.

The prototype is intended to explore this model and should undergo additional security review before handling real-value transactions.

---

## Tech Stack

### Blockchain

* **Solana**
* **Rust**
* **Anchor**
* **Durable Nonce Accounts**

### Client

* **React**
* **TypeScript**
* **Progressive Web App (PWA)**
* **@solana/web3.js**
* **Solana Wallet Adapter**

### Local Storage

* **IndexedDB**
* **localForage**

### Offline Transfer

* **QR code generation**
* **QR code scanning**

### Development

* **Solana CLI**
* **Anchor CLI**
* **Solana Devnet / Localnet**
* **Git / GitHub**

---

## Project Structure

```text
pat/
├── programs/
│   └── pat/
│       └── src/
│           └── lib.rs
│
├── app/
│   └── ...
│
├── tests/
│   └── ...
│
├── Anchor.toml
├── Cargo.toml
└── README.md
```

---

## Who Built PAT?

**Hilda Enyioko**

Backend / Full-Stack Engineer focused on payment systems, financial infrastructure, and distributed systems.

Hilda has worked across fintech, payment integrations, backend systems, and blockchain development, with experience using technologies including TypeScript, Python, Django, NestJS, PostgreSQL, Redis, Paystack, Interswitch, Solana, and Anchor.

PAT was created to explore how blockchain payment infrastructure can remain useful when one of the assumptions it normally depends on, **continuous connectivity**, temporarily disappears.

---

## Project Status

🚧 **Prototype / Hackathon Project**

PAT is an experimental project exploring offline-friendly, self-custodial payments on Solana.

The current implementation is intended for demonstration and research rather than production financial use.

---

## Project Resources

### 🎥 Pitch Video

Coming soon.

**Dummy link:**
`https://example.com/pat-pitch`

A short explanation of the problem, the PAT protocol, and the reservation-based offline payment model.

### 🌐 Live Demo

Coming soon.

**Dummy link:**
`https://pat-demo.example.com`

### 🎬 Demo Video

Coming soon.

**Dummy link:**
`https://example.com/pat-demo`

The demo will show:

1. Establishing an offline spending allowance
2. Losing connectivity
3. Creating and signing a payment
4. Transferring the payment to a merchant
5. Showing the **Offline Accepted** state
6. Restoring connectivity
7. Broadcasting the transaction
8. Showing the final **Confirmed** state
9. Demonstrating the offline spending limit

---

## The Idea

PAT is built around one simple principle:

> **Reserve while connected. Spend while disconnected. Settle when reconnected.**

The goal is not to replace online payments.

It is to make temporary loss of connectivity **less capable of stopping a payment altogether**.
