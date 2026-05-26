# Pat

**Pat** is a developer-first payment abstraction layer built to simplify payment gateway integrations in Nigeria.

Instead of integrating separately with multiple providers like Paystack, Flutterwave, or Interswitch, developers integrate once with Pat and get a unified API experience across providers.

Pat focuses on:

* Consistent API contracts
* Transparent error handling
* Reliable webhook delivery
* Clean developer experience
* Extensible gateway architecture

---

## Why Pat Exists

Integrating Nigerian payment gateways can be frustrating because of:

* Inconsistent transaction responses
* Poorly documented edge cases
* Gateway-specific integration logic
* Unclear error messages
* Webhook reliability issues
* Sandbox environments that differ from production

Pat aims to solve these problems by acting as a middleware layer between applications and payment providers.

---

## MVP Goals

The Pat MVP is focused on proving the core concept:

### Features

* Unified payment initiation endpoint
* Multiple gateway adapters
* Standardized transaction responses
* Structured error handling
* Webhook normalization
* Transaction logging
* Minimal dashboard for monitoring transactions

---

## Architecture Overview

```text
Client Application
        |
        v
      PAT API
        |
  ----------------
  |      |       |
Paystack Flutterwave Interswitch
```

Pat sits between client applications and payment providers, normalizing requests and responses into a consistent developer experience.

---

## Tech Stack

### Backend

* Python
* Django
* Django REST Framework
* PostgreSQL

### Planned Frontend

* React
* TypeScript

---

## Core Philosophy

### 1. Provider-Agnostic Integrations

One API contract regardless of payment provider.

### 2. Honest Errors

Instead of:

```json
{
  "message": "Transaction failed"
}
```

Pat returns:

```json
{
  "code": "CARD_LIMIT_EXCEEDED",
  "message": "Card transaction limit exceeded",
  "provider": "paystack",
  "suggested_action": "Prompt user to try bank transfer"
}
```

### 3. Reliable Webhooks

Webhook events are:

* Logged
* Normalized
* Retried if delivery fails
* Stored with delivery status

### 4. Extensible Gateway Design

New providers can be added through adapters without changing the core API.

---

## Planned Gateway Support

### MVP

* Paystack
* Flutterwave

### Future Support

* Interswitch
* Zest

---

## Example Payment Flow

```text
1. Client sends payment request to Pat
2. Pat selects configured provider
3. Pat forwards request to provider API
4. Provider returns transaction response
5. Pat normalizes response
6. Client receives consistent Pat response
```

---

## Example API Request

```http
POST /api/v1/pay/
```

```json
{
  "amount": 5000,
  "currency": "NGN",
  "email": "user@example.com",
  "provider": "paystack"
}
```

---

## Project Status

🚧 MVP in active development

Current focus:

* Core API structure
* Gateway adapters
* Webhook processing
* Transaction models
* Error normalization

---

## Vision

Pat is not a payment processor.

Pat is a developer tooling layer designed to make payment integrations in Africa cleaner, more reliable, and easier to maintain.

The long-term goal is to become a unified payment infrastructure layer developers actually enjoy working with.

---

## Author

Built by Hilda Enyioko
Software Engineer • API Builder • Fintech-Focused Developer
