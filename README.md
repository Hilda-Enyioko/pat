# PAT

### Primitive Airborne Transaction

PAT is a self-custodial payment protocol designed to enable **offline-friendly Solana transactions** between users and merchants, even when internet connectivity is unreliable.

The project explores how Solana's transaction infrastructure can be adapted for environments where a user may temporarily lose access to the internet but still needs to initiate a payment.

---

## 1. What This Repository Is

This repository contains the source code for **PAT (Primitive Airborne Transaction)**, a Solana-based payment protocol and Progressive Web App (PWA).

It brings together on-chain programs, client-side wallet functionality, and offline transaction workflows to experiment with reliable peer-to-merchant payments under intermittent connectivity.

---

## 2. What the Project Does

PAT allows a sender to prepare and sign a transaction while offline, transfer the transaction data to a merchant through a local mechanism such as **QR code**, and allow the transaction to be broadcast and settled once connectivity becomes available.

The core flow is:

**Create → Sign → Transfer → Broadcast → Confirm**

The protocol uses Solana primitives such as **Durable Nonce Accounts** and on-chain transaction logic to help preserve the validity of transactions during periods of connectivity loss.

---

## 3. What It Is Built For

PAT is built for environments where reliable internet access cannot be assumed.

Potential use cases include:

* Offline or low-connectivity merchant payments
* Rural and underserved communities
* Temporary network outages
* Markets and events with unreliable connectivity
* Peer-to-merchant payments where both parties may not be continuously online
* Mobile-first payment experiences

The project is built around the idea that **a payment should not necessarily fail simply because the internet temporarily disappears.**

### Technology Stack

**On-chain**

* Solana
* Anchor
* Rust
* Solana Durable Nonce Accounts

**Client-side**

* React
* Progressive Web App (PWA)
* `@solana/web3.js`
* Solana Wallet Adapter
* IndexedDB / localForage

**Offline Transfer**

* QR code generation
* QR code scanning

**Development**

* Solana CLI
* Anchor CLI
* Solana Devnet / Localnet

---

## 4. Who Built It

PAT was built by:

### Hilda Enyioko

Backend / Full-Stack Engineer with a focus on **payment systems, financial infrastructure, and distributed systems**.

Hilda's work spans backend engineering, fintech, payment integrations, and blockchain development, with experience working with technologies including **TypeScript, Python, Django, NestJS, PostgreSQL, Redis, Paystack, Interswitch, Solana, and Anchor**.

---

## 5. Content

This repository contains:

* Solana programs
* Anchor/Rust smart contract code
* React PWA client
* Wallet integration
* Offline transaction handling
* QR-based transaction transfer
* Durable nonce transaction flow
* Local development configuration
* Documentation and project resources

> **Note:** PAT is currently a prototype and is intended for experimentation and demonstration. It should not be used for real-value transactions without appropriate security review and production hardening.

---

## 6. Project Resources

### 🎥 Pitch Video

**Coming soon**

> Dummy link: `https://example.com/pat-pitch`

A short presentation explaining the problem, the PAT protocol, and the motivation behind offline-friendly Solana payments.

### 🌐 Live Demo

**Coming soon**

> Dummy link: `https://pat-demo.example.com`

The live web application demonstrating the PAT payment flow.

### 🎬 Demo Video

**Coming soon**

> Dummy link: `https://example.com/pat-demo`

A walkthrough showing the complete flow from transaction creation and signing to QR transfer, broadcasting, and confirmation.

---

## Project Status

🚧 **Prototype / Hackathon Project**

PAT is actively being developed. Features, architecture, and implementation details may change as the protocol evolves.
