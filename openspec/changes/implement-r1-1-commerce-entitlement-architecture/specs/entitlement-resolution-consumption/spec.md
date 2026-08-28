## ADDED Requirements

### Requirement: Business modules use a neutral consumption contract
Daily energy, card reading, and future deliverable modules SHALL request benefit use through a ConsumptionPort using a service requirement and opaque business context and MUST NOT directly update entitlement or seed ledger tables.

#### Scenario: Card reading requests consumption
- **WHEN** card reading submits the user, business space, service type, card count, quantity, and reading-intent identifier
- **THEN** consumption resolves and reserves an eligible source without reading or storing the user's question text

### Requirement: Fixed system-only resolution priority
The system SHALL select the source without user choice using this fixed order: eligible current-period membership grant, earliest-expiring purchased service pack, earliest-expiring eligible seed grants, then no-source purchase recommendation.

#### Scenario: Member, pack and seeds are all available
- **WHEN** a card-reading requirement is resolved
- **THEN** the system selects the current membership reading grant and records all candidate sources and the rule version

#### Scenario: No membership grant is available
- **WHEN** two purchased reading packs and seeds are eligible
- **THEN** the system selects the earliest-expiring purchased pack

#### Scenario: No benefit is available
- **WHEN** no eligible membership, purchased grant, or seed quantity can satisfy the requirement
- **THEN** the system returns a deterministic purchase-required result without creating a reservation

### Requirement: Resolution is auditable and not user-selectable
Each EntitlementResolution SHALL store candidate snapshots, selected source, reason, cost, rule version and expiry, SHALL set selection mode to `SYSTEM_RULE`, and SHALL expose no API that lets the user override the source.

#### Scenario: Client attempts source override
- **WHEN** a client submits a source identifier different from the system resolution
- **THEN** the system rejects or ignores it and preserves the server-selected source

### Requirement: Reserve before card draw
The system MUST create and successfully reserve a ConsumptionIntent before the card-reading module freezes a server-random card draw.

#### Scenario: Reservation succeeds
- **WHEN** the selected source can be atomically reserved
- **THEN** consumption returns an active intent and card reading may proceed to draw

#### Scenario: Reservation fails concurrently
- **WHEN** the selected benefit is consumed by another request before reservation completes
- **THEN** the system re-resolves or returns an entitlement conflict and does not allow a card draw

### Requirement: Thirty-minute pre-draw expiration
A reserved ConsumptionIntent SHALL expire and release its reservation if no formal card draw starts within 30 minutes. Once draw execution starts, the 30-minute expiration SHALL be disabled and the intent SHALL follow the business task terminal state.

#### Scenario: User abandons before draw
- **WHEN** 30 minutes elapse after reservation and the reading has not frozen a draw
- **THEN** the system releases the original reservation exactly once and marks the intent expired

#### Scenario: Generation exceeds 30 minutes
- **WHEN** a draw has started and report generation continues beyond the original reservation deadline
- **THEN** the reservation remains active until complete delivery, failure, or cancellation

### Requirement: Commit only after complete delivery
The system SHALL commit consumption only after the business service reports complete, quality-valid delivery and SHALL release the reservation on cancellation or final failure.

#### Scenario: Complete reading report is delivered
- **WHEN** the report passes required structure and safety validation and becomes ready
- **THEN** consumption commits the selected source once and records the actual source in the business result

#### Scenario: Generation fails finally
- **WHEN** the generation task reaches a final failed state
- **THEN** consumption releases the reservation once and the same draw may be retried according to reading rules without duplicate consumption

### Requirement: Consumption recovery and reconciliation
The system SHALL make resolution and intent state queryable by business context, SHALL make every action idempotent, and SHALL reconcile intents against business tasks and ledger reservations.

#### Scenario: Process crashes after ledger reserve
- **WHEN** the reserve succeeds but the caller loses the response before recording progress
- **THEN** replay by the same business context and idempotency key returns the existing intent instead of reserving again

#### Scenario: Stale running intent is found
- **WHEN** reconciliation finds a running intent whose business task is terminal
- **THEN** it deterministically commits or releases from the authoritative task outcome and records the repair
