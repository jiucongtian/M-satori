# money-order-payment-fulfillment Specification

## Purpose
TBD - created by archiving change implement-r1-1-commerce-entitlement-architecture. Update Purpose after archive.
## Requirements
### Requirement: Order created from immutable quote snapshot
The system SHALL create a MoneyOrder only from a valid authoritative CheckoutQuote and SHALL store immutable snapshots of the offering, price, currency, benefits, validity, agreement, fulfillment standard, and refund policy.

#### Scenario: Successful order creation
- **WHEN** a user submits a valid quote and an unused idempotency key
- **THEN** the system creates one `AWAITING_PAYMENT` order with the quote snapshot and returns the same order for an idempotent replay

#### Scenario: Client changes the amount
- **WHEN** a client sends an amount that differs from the authoritative quote
- **THEN** the system ignores or rejects the client amount and never creates an order with altered pricing

### Requirement: Unpaid order expiration
The system SHALL close an unpaid order 30 minutes after creation and SHALL release any seed promotion reservation associated with that order.

#### Scenario: Order expires without payment
- **WHEN** an order remains unpaid for 30 minutes
- **THEN** the system marks it `CLOSED`, prevents new successful payment attempts, and releases reserved promotion seeds exactly once

#### Scenario: Payment callback races with closure
- **WHEN** a valid provider payment success races with the order-closing job
- **THEN** the system resolves the race from the provider's authoritative payment time and produces one auditable terminal money fact

### Requirement: Payment provider isolation
The system SHALL integrate payment channels through a PaymentProvider port, SHALL use a server-side deterministic Fake provider for the current end-to-end milestone, and SHALL keep future WeChat DTOs and signatures outside the order and entitlement domains.

#### Scenario: Fake payment attempt is created
- **WHEN** a user pays an eligible awaiting-payment order while the environment is configured for automatic Fake success
- **THEN** the payment module creates a PaymentAttempt, records the server-side provider result, and the client proceeds to payment-result polling without invoking WeChat

#### Scenario: Real WeChat remains disabled
- **WHEN** merchant credentials and payment-scene acceptance are not complete
- **THEN** the deployment remains in Fake mode and cannot present an unverified WeChat result as a successful money fact

#### Scenario: Additional provider is introduced
- **WHEN** a future provider adapter is added
- **THEN** existing order, fulfillment, membership, and entitlement domain contracts remain unchanged

### Requirement: Authoritative and idempotent payment success
The system MUST accept real-provider payment success only from a verified provider callback or active provider query, MUST validate merchant, order, amount and currency, and MUST deduplicate provider events and successful money facts. In Fake mode it MUST accept only the server-side deterministic provider result and MUST NOT trust a client success page.

#### Scenario: Duplicate callback
- **WHEN** WeChat sends the same successful payment callback more than once
- **THEN** the system records one successful PaymentAttempt outcome and initiates fulfillment once

#### Scenario: Forged or mismatched callback
- **WHEN** a callback fails signature verification or carries a mismatched merchant, amount, currency, or order reference
- **THEN** the system rejects it, records a security event, and does not mark the order paid

### Requirement: Payment and fulfillment states are separate
The system SHALL maintain independent order, payment and fulfillment states; payment success SHALL transition the order to paid/fulfilling but SHALL NOT imply that membership or entitlements have been delivered.

#### Scenario: Payment succeeds and grant is delayed
- **WHEN** payment is successful but fulfillment has not completed
- **THEN** the user sees a paid and fulfilling state and is not prompted to purchase again

#### Scenario: Fulfillment event is replayed
- **WHEN** the worker processes the same fulfillment request multiple times
- **THEN** the target membership or entitlement grant is created exactly once and the order reaches `FULFILLED` once

### Requirement: Ordinary refund and exceptional money reversal
The system SHALL support versioned refund rules for ordinary orders and SHALL support original-channel reversal for duplicate charges or final inability to fulfill a paid order. Membership-upgrade residual value MUST NOT create a refund.

#### Scenario: Ordinary eligible refund
- **WHEN** an ordinary order satisfies its snapshotted RefundPolicy and the relevant remaining entitlements are frozen
- **THEN** the system creates one refund, processes it through the original provider, and applies linked reverse entitlement records on success

#### Scenario: Paid order cannot be fulfilled
- **WHEN** all fulfillment retries are exhausted for a paid order
- **THEN** the system initiates an exceptional original-channel reversal and preserves the failed fulfillment evidence

#### Scenario: Membership upgrade replaces old period
- **WHEN** a new membership upgrade order is fulfilled
- **THEN** the system does not create a refund for the old period's unused time or quota

### Requirement: Financial reconciliation and privacy
The system SHALL reconcile orders, payment attempts, provider transactions, refunds and fulfillment outcomes, and commerce services MUST NOT access card-reading questions or report bodies.

#### Scenario: Reconciliation finds a mismatch
- **WHEN** provider records disagree with local payment or refund facts
- **THEN** the system raises a traceable reconciliation case without silently rewriting history

#### Scenario: Commerce record references a reading
- **WHEN** an order or fulfillment job is linked to a card-reading flow
- **THEN** it stores only opaque business context identifiers and cannot retrieve the user's question or report content
