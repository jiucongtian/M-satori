## ADDED Requirements

### Requirement: Versioned sellable offerings
The system SHALL represent every sellable R1.1 product as a stable ServiceOffering with an immutable published OfferingVersion containing business space, service type, RMB price in integer cents, entitlement specification, validity rule, purchase limit, agreement version, fulfillment standard, and refund policy version.

#### Scenario: Published product changes price
- **WHEN** an operator publishes a new price or benefit configuration for an existing offering
- **THEN** the system creates a new OfferingVersion and leaves prior versions unchanged

#### Scenario: Unsupported R1.1 product is requested
- **WHEN** a client requests a purchasable offering outside daily energy, card reading, their service packs, or the three R1.1 monthly plans
- **THEN** the system rejects the request and does not expose a payable offering

### Requirement: Authoritative checkout quote
The system SHALL calculate price, promotion eligibility, purchase limits, currency, benefits, validity, and user-facing terms on the server and SHALL issue a user-bound CheckoutQuote valid for 15 minutes.

#### Scenario: Eligible standard quote
- **WHEN** an eligible user requests a quote for a currently published offering
- **THEN** the system returns a quote containing the authoritative OfferingVersion snapshot, amount, currency, expiry, benefits, and applicable rules

#### Scenario: Expired quote is used
- **WHEN** a client attempts to create an order from a quote older than 15 minutes
- **THEN** the system rejects the operation with `CHECKOUT_QUOTE_EXPIRED` and does not create an order

### Requirement: Seed promotion is qualification, not payment
The system MUST model a wisdom-seed promotion as a versioned rule that unlocks an RMB activity price and MUST NOT represent seeds as cash, partial payment, discount currency, or a fixed RMB exchange rate.

#### Scenario: User qualifies for activity price
- **WHEN** the user satisfies the offering-specific seed threshold and rule scope
- **THEN** the quote states the RMB activity price and required seed reservation without expressing a cash value per seed

#### Scenario: User lacks promotion eligibility
- **WHEN** the user does not have enough eligible seed grants or violates the activity limit
- **THEN** the system returns the standard RMB quote or a deterministic ineligibility result without consuming seeds

### Requirement: Quote revalidation on order creation
The system MUST revalidate the quote owner, offering status, version, purchase limit, price, seed eligibility, and expiry before an order is created; the client-provided amount or benefit quantity MUST NOT be trusted.

#### Scenario: Product changes after quote creation
- **WHEN** a new OfferingVersion is published while an unexpired quote still references the old published version
- **THEN** the system follows the configured quote honor policy and records the exact honored version in the order snapshot

#### Scenario: Purchase limit is reached concurrently
- **WHEN** two concurrent order requests would exceed a one-time purchase limit
- **THEN** at most one request succeeds and the other receives `PURCHASE_LIMIT_REACHED`

### Requirement: Catalog and quote auditability
The system SHALL retain publication actor, publication time, rule versions, quote inputs, qualification result, and request identifiers required to explain every issued quote without storing card-reading question or report content.

#### Scenario: Customer service explains historical price
- **WHEN** an authorized operator inspects an order's quote reference
- **THEN** the system can reconstruct the offering version, promotion rule, qualification result, and quoted RMB amount used at purchase time
