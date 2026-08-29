# complimentary-seed-ledger Specification

## Purpose
TBD - created by archiving change implement-r1-1-commerce-entitlement-architecture. Update Purpose after archive.
## Requirements
### Requirement: Seed grants remain non-cash complimentary benefits
The system SHALL issue wisdom seeds only as ComplimentarySeedGrant batches from approved free, membership, academy, activity, or compensation sources and MUST NOT sell, transfer, withdraw, redeem, or value them as cash.

#### Scenario: Registration reward is granted
- **WHEN** an eligible new user receives a registration reward
- **THEN** the system creates one seed grant batch with source, scope, quantity, validity, and rule version

#### Scenario: Client attempts seed purchase
- **WHEN** a client attempts to create a general wisdom-seed top-up order
- **THEN** the system rejects the request because no such sellable offering exists

### Requirement: Batch scope and validity
Each seed grant SHALL define eligible AI service scopes, available and reserved quantities, validity, source and rule version; expired or out-of-scope seed quantities MUST NOT be selected.

#### Scenario: Reading-only seeds are used for daily energy
- **WHEN** a daily-energy requirement evaluates a reading-only seed grant
- **THEN** the grant is excluded from eligible candidates

#### Scenario: Seed batch expires
- **WHEN** the batch expiry time is reached
- **THEN** its remaining quantity becomes unavailable and an auditable expiry record is produced

### Requirement: Append-only seed settlement
The seed ledger MUST append immutable grant, reserve, consume, release, restore, expiry, and adjustment entries and MUST update the grant and account projections atomically without allowing negative balances.

#### Scenario: Seed-backed reading succeeds
- **WHEN** a seed reservation backs a fully delivered card reading
- **THEN** the system consumes the versioned card-count cost exactly once

#### Scenario: Seed-backed reading fails
- **WHEN** the reading fails or is cancelled before complete delivery
- **THEN** the system releases the exact reserved quantity to the original grant batches exactly once

### Requirement: Card-count-based reading cost
The system SHALL calculate wisdom-seed cost for card reading from the confirmed card count and a versioned consumption rule, while paid and membership reading credits remain one credit per complete reading.

#### Scenario: User changes card count before reservation
- **WHEN** the confirmed card count changes before a consumption intent is created
- **THEN** the system recalculates the seed cost using the current applicable rule version

#### Scenario: Rule changes after reservation
- **WHEN** the seed cost rule is updated after a consumption intent has reserved seeds
- **THEN** the existing intent retains its snapshotted cost and rule version

### Requirement: Seed promotion reservation lifecycle
For a seed-unlocked RMB activity price, the system SHALL validate eligibility at quote time, reserve the required seeds when the order is created, consume them after verified payment success, and release them when the order is cancelled, expires, or payment fails.

#### Scenario: Activity-price order is paid
- **WHEN** verified payment succeeds for an order with a seed promotion reservation
- **THEN** the system consumes the reserved seeds exactly once and continues fulfillment

#### Scenario: Activity-price order closes unpaid
- **WHEN** the order reaches its 30-minute unpaid expiry
- **THEN** the system releases the exact promotion seed reservation exactly once

### Requirement: Seed batch ordering and account projection
Eligible seed grants SHALL be offered in earliest-expiry order, and the user-level available/reserved account SHALL be a reconciled projection rather than the sole settlement fact.

#### Scenario: Multiple eligible seed batches exist
- **WHEN** a requirement needs more seeds than the first eligible batch contains
- **THEN** the reservation deterministically allocates across eligible batches in expiry order and records every allocation

### Requirement: Existing balance migration
The system SHALL migrate an existing R1.0 user seed balance into traceable opening grant batches without changing the user's available or reserved totals and SHALL retain historical seed entries for audit.

#### Scenario: User has legacy available and reserved seeds
- **WHEN** the batch-ledger migration runs
- **THEN** opening grants and migration records reproduce both totals and the migration reconciliation passes before the new ledger becomes authoritative
