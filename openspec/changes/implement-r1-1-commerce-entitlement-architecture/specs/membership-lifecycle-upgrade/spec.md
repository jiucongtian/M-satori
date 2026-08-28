## ADDED Requirements

### Requirement: Membership plan and subscription are separate
The system SHALL represent Glow, Serenity, and Freedom as versioned 30-day MembershipPlans and SHALL represent each user's purchased period as a MembershipSubscription linked to its source order and generated entitlement grants. Membership identity MUST NOT act as a spendable balance.

#### Scenario: New membership is fulfilled
- **WHEN** a paid membership order is successfully fulfilled for a user without an active membership
- **THEN** the system starts one 30-day subscription period and issues the plan's service-specific grants exactly once

### Requirement: Single active membership timeline
Within a business space, the system SHALL allow at most one active membership period per user and SHALL order future renewal periods without overlap.

#### Scenario: Active member renews manually
- **WHEN** an active member buys the same plan without choosing upgrade
- **THEN** the new period is queued immediately after the current period and its benefits are not issued before that start time

#### Scenario: Expired member buys a plan
- **WHEN** a user with no active period completes a membership purchase
- **THEN** the new period starts immediately after fulfillment

### Requirement: Period benefits do not carry over
Membership service grants SHALL be bound to their exact period, SHALL become available only when that period starts, and SHALL expire without carryover when the period ends.

#### Scenario: Membership period ends with unused quota
- **WHEN** the subscription period reaches its end
- **THEN** remaining period grants expire with append-only expiry records and are not added to the next period

### Requirement: Upgrade uses full-price replacement
An upgrade SHALL require a new full-price order for an allowed higher plan. After successful new-plan fulfillment, the new 30-day period SHALL start immediately, the old period SHALL terminate, and all old-period remaining entitlements SHALL be forfeited without refund, price offset, or carryover.

#### Scenario: Glow upgrades to Serenity
- **WHEN** the user's full Serenity order payment and fulfillment succeed
- **THEN** Serenity starts immediately, Glow terminates, old Glow grants are forfeited, and no old-order refund is created

#### Scenario: Upgrade confirmation is displayed
- **WHEN** the user reviews an upgrade purchase before payment
- **THEN** the system clearly states that the old plan ends and its remaining uses are not retained, without presenting them as a refundable amount

### Requirement: Residual value is internal analysis only
The system SHALL snapshot remaining time ratio, remaining quota ratio, residual value estimate, and assessment rule version for an upgrade, and MUST NOT use the estimate to alter payable amount, create a refund, produce financial payable, or expose a refund rule to the user.

#### Scenario: Upgrade assessment is calculated
- **WHEN** an upgrade is initiated from an active membership
- **THEN** the assessment is stored for internal audit and analytics while the new order remains full price

### Requirement: Upgrade fulfillment is a recoverable saga
The system SHALL make new membership activation, new grant issuance, old-period termination, old-grant forfeiture, and upgrade completion idempotent and recoverable. The old period SHALL NOT terminate before the new order is paid and the new plan can be fulfilled.

#### Scenario: New-plan grant issuance temporarily fails
- **WHEN** payment succeeds but new membership benefits cannot yet be issued
- **THEN** the order remains fulfilling, the old membership remains usable until safe replacement, and the saga retries without duplicate grants

#### Scenario: New plan cannot be fulfilled finally
- **WHEN** fulfillment retries are exhausted before replacement commits
- **THEN** the system preserves the old membership and processes the new paid order as an inability-to-fulfill exception

### Requirement: Membership expiration and issuance jobs are auditable
The system SHALL run idempotent period-start and period-end jobs and SHALL reconcile subscription status, period dates, source orders, and entitlement grant references.

#### Scenario: Worker processes period start twice
- **WHEN** the same period-start job is delivered more than once
- **THEN** the system activates the period and issues each configured grant once

#### Scenario: Period grant is missing
- **WHEN** reconciliation finds an active subscription without its expected entitlement grant
- **THEN** the system creates a traceable repair task and does not silently change subscription history
