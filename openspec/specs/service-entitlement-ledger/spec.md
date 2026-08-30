# service-entitlement-ledger Specification

## Purpose
TBD - created by archiving change implement-r1-1-commerce-entitlement-architecture. Update Purpose after archive.
## Requirements
### Requirement: Independent entitlement grant per source batch
The system SHALL create an EntitlementGrant for each purchase, membership period, promotion, or compensation source and SHALL record service type, unit, total, available, reserved, validity, source, business space, and rule version.

#### Scenario: User buys the same pack twice
- **WHEN** a user successfully purchases two card-reading packs
- **THEN** the system creates two independent grants with separate source orders, balances, and expiry times

#### Scenario: Membership period starts
- **WHEN** a membership period becomes active
- **THEN** the system creates service-specific membership grants linked to that exact subscription period

### Requirement: Natural-day package expiration
For purchase-based service packs, the system SHALL treat the China Standard Time payment-success date as day one and SHALL expire the grant at the end of the Nth natural day, while storing the resulting UTC timestamp, expiry timezone, and rule version.

#### Scenario: Thirty-day pack bought on August 28
- **WHEN** a 30-day pack payment succeeds on August 28 in `Asia/Shanghai`
- **THEN** its grant expires at the end of September 26 in `Asia/Shanghai` and exposes the equivalent UTC timestamp

#### Scenario: Multiple packs overlap
- **WHEN** a user buys a new pack while an older pack remains valid
- **THEN** neither grant's validity is extended or merged and each retains its independently calculated expiry

### Requirement: Append-only entitlement usage records
Every grant, reservation, commit, release, reversal, expiry, freeze, unfreeze, forfeiture, and manual adjustment MUST append an immutable usage record linked to its originating source and business context.

#### Scenario: Reservation completes successfully
- **WHEN** a reserved service is fully delivered
- **THEN** the system appends one commit record referencing the reservation and updates the balance projection atomically

#### Scenario: Operator adjusts an entitlement
- **WHEN** an authorized operator applies a correction
- **THEN** the system appends an adjustment record with actor, reason, request ID, and related object and does not edit prior records

### Requirement: Atomic reservation settlement
The system MUST atomically update grant balance projections and append ledger records, MUST prevent negative available or reserved balances, and MUST allow each reservation to be settled by commit or release at most once.

#### Scenario: Concurrent reservation of final unit
- **WHEN** two requests concurrently reserve the last available unit of the same grant
- **THEN** exactly one succeeds and no balance becomes negative

#### Scenario: Commit is replayed
- **WHEN** a commit command with the same consumption intent and action is retried
- **THEN** the system returns the original result without consuming another unit

### Requirement: Deterministic earliest-expiry selection
When multiple eligible grants of the same source class exist, the entitlement ledger SHALL return candidates ordered by `expiresAt`, then `grantedAt`, then stable grant identifier.

#### Scenario: Two card-reading packs are available
- **WHEN** one eligible pack expires earlier than the other
- **THEN** the earlier-expiring pack is returned first for fixed-rule consumption

### Requirement: Source-separated views and audit
The system SHALL expose balances and usage grouped by purchase, membership, compensation and other source types and MUST NOT collapse those sources into an untraceable generic balance.

#### Scenario: User has member and purchased reading credits
- **WHEN** the user views service entitlements
- **THEN** the response identifies each grant's source, remaining quantity, validity, and status separately

### Requirement: Entitlement reconciliation
The system SHALL provide reconciliation that verifies each grant projection against append-only records and verifies reserved amounts against active consumption intents.

#### Scenario: Orphaned reservation is detected
- **WHEN** a grant remains reserved without a valid active consumption intent
- **THEN** reconciliation reports the inconsistency for automatic safe release or controlled operator repair
