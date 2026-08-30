CREATE TABLE "checkout_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"offering_version_id" uuid NOT NULL,
	"seed_promotion_rule_id" uuid,
	"status" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"pricing_mode" varchar(32) NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"reserved_seed_quantity" integer DEFAULT 0 NOT NULL,
	"qualification_snapshot" jsonb NOT NULL,
	"pricing_snapshot" jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_quotes_status_ck" CHECK ("checkout_quotes"."status" in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED')),
	CONSTRAINT "checkout_quotes_mode_ck" CHECK ("checkout_quotes"."pricing_mode" in ('STANDARD', 'SEED_PROMOTION')),
	CONSTRAINT "checkout_quotes_amount_ck" CHECK ("checkout_quotes"."amount_minor" >= 0 and "checkout_quotes"."currency" = 'CNY' and "checkout_quotes"."reserved_seed_quantity" >= 0),
	CONSTRAINT "checkout_quotes_expiry_ck" CHECK ("checkout_quotes"."expires_at" > "checkout_quotes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "complimentary_seed_account_projections" (
	"owner_user_id" uuid PRIMARY KEY NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"available_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"total_granted" bigint DEFAULT 0 NOT NULL,
	"total_consumed" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complimentary_seed_account_projections_balance_ck" CHECK ("complimentary_seed_account_projections"."available_quantity" >= 0 and "complimentary_seed_account_projections"."reserved_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "complimentary_seed_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"consumption_intent_id" uuid,
	"quantity" integer NOT NULL,
	"status" varchar(24) DEFAULT 'RESERVED' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complimentary_seed_allocations_quantity_ck" CHECK ("complimentary_seed_allocations"."quantity" > 0),
	CONSTRAINT "complimentary_seed_allocations_status_ck" CHECK ("complimentary_seed_allocations"."status" in ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "complimentary_seed_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"entry_type" varchar(24) NOT NULL,
	"quantity" integer NOT NULL,
	"available_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"business_key" varchar(160) NOT NULL,
	"reservation_id" uuid,
	"consumption_intent_id" uuid,
	"business_context_type" varchar(64),
	"business_context_id" varchar(128),
	"original_entry_id" uuid,
	"operator_adjustment_id" uuid,
	"request_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complimentary_seed_entries_type_ck" CHECK ("complimentary_seed_entries"."entry_type" in ('GRANT', 'RESERVE', 'CONSUME', 'RELEASE', 'RESTORE', 'EXPIRE', 'ADJUSTMENT')),
	CONSTRAINT "complimentary_seed_entries_quantity_ck" CHECK ("complimentary_seed_entries"."quantity" > 0),
	CONSTRAINT "complimentary_seed_entries_balance_ck" CHECK ("complimentary_seed_entries"."available_after" >= 0 and "complimentary_seed_entries"."reserved_after" >= 0),
	CONSTRAINT "complimentary_seed_entries_context_pair_ck" CHECK (("complimentary_seed_entries"."business_context_type" is null) = ("complimentary_seed_entries"."business_context_id" is null))
);
--> statement-breakpoint
CREATE TABLE "complimentary_seed_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"applicable_services" jsonb NOT NULL,
	"total_quantity" integer NOT NULL,
	"available_quantity" integer NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_at" timestamp with time zone NOT NULL,
	"expiry_timezone" varchar(64),
	"rule_version" varchar(64) NOT NULL,
	"migration_version" varchar(64),
	"request_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complimentary_seed_grants_balance_ck" CHECK ("complimentary_seed_grants"."total_quantity" > 0 and "complimentary_seed_grants"."available_quantity" >= 0 and "complimentary_seed_grants"."reserved_quantity" >= 0 and "complimentary_seed_grants"."available_quantity" + "complimentary_seed_grants"."reserved_quantity" <= "complimentary_seed_grants"."total_quantity"),
	CONSTRAINT "complimentary_seed_grants_period_ck" CHECK ("complimentary_seed_grants"."expires_at" is null or "complimentary_seed_grants"."expires_at" > "complimentary_seed_grants"."effective_at"),
	CONSTRAINT "complimentary_seed_grants_status_ck" CHECK ("complimentary_seed_grants"."status" in ('PENDING', 'ACTIVE', 'FROZEN', 'EXHAUSTED', 'EXPIRED')),
	CONSTRAINT "complimentary_seed_grants_source_ck" CHECK ("complimentary_seed_grants"."source_type" in ('REGISTRATION', 'ACTIVITY', 'MANUAL', 'RESTORE', 'MIGRATION'))
);
--> statement-breakpoint
CREATE TABLE "consumption_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resolution_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"service_type" varchar(64) NOT NULL,
	"business_context_type" varchar(64) NOT NULL,
	"business_context_id" varchar(128) NOT NULL,
	"status" varchar(24) DEFAULT 'RESERVING' NOT NULL,
	"selected_source_type" varchar(32) NOT NULL,
	"selected_source_id" varchar(128) NOT NULL,
	"required_quantity" integer NOT NULL,
	"reservation_deadline" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"request_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_intents_status_ck" CHECK ("consumption_intents"."status" in ('RESERVING', 'RESERVED', 'RUNNING', 'COMMITTED', 'RELEASED', 'EXPIRED', 'FAILED')),
	CONSTRAINT "consumption_intents_quantity_ck" CHECK ("consumption_intents"."required_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "entitlement_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"service_type" varchar(64) NOT NULL,
	"unit" varchar(32) NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"total_quantity" integer NOT NULL,
	"available_quantity" integer NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expiry_timezone" varchar(64) NOT NULL,
	"rule_version" varchar(64) NOT NULL,
	"request_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_grants_balance_ck" CHECK ("entitlement_grants"."total_quantity" > 0 and "entitlement_grants"."available_quantity" >= 0 and "entitlement_grants"."reserved_quantity" >= 0 and "entitlement_grants"."available_quantity" + "entitlement_grants"."reserved_quantity" <= "entitlement_grants"."total_quantity"),
	CONSTRAINT "entitlement_grants_period_ck" CHECK ("entitlement_grants"."expires_at" > "entitlement_grants"."effective_at" and "entitlement_grants"."granted_at" <= "entitlement_grants"."effective_at"),
	CONSTRAINT "entitlement_grants_status_ck" CHECK ("entitlement_grants"."status" in ('PENDING', 'ACTIVE', 'FROZEN', 'EXHAUSTED', 'EXPIRED', 'FORFEITED')),
	CONSTRAINT "entitlement_grants_source_ck" CHECK ("entitlement_grants"."source_type" in ('PURCHASE', 'MEMBERSHIP', 'MANUAL', 'MIGRATION'))
);
--> statement-breakpoint
CREATE TABLE "entitlement_resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"service_type" varchar(64) NOT NULL,
	"quantity" integer NOT NULL,
	"unit" varchar(32) NOT NULL,
	"business_context_type" varchar(64) NOT NULL,
	"business_context_id" varchar(128) NOT NULL,
	"status" varchar(24) NOT NULL,
	"selected_source_type" varchar(32),
	"selected_source_id" varchar(128),
	"reason_code" varchar(64) NOT NULL,
	"selection_mode" varchar(32) DEFAULT 'SYSTEM_RULE' NOT NULL,
	"rule_version" varchar(64) NOT NULL,
	"requirement_snapshot" jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_resolutions_quantity_ck" CHECK ("entitlement_resolutions"."quantity" > 0),
	CONSTRAINT "entitlement_resolutions_status_ck" CHECK ("entitlement_resolutions"."status" in ('RESOLVED', 'NO_BENEFIT', 'INVALID')),
	CONSTRAINT "entitlement_resolutions_selection_ck" CHECK ("entitlement_resolutions"."selection_mode" = 'SYSTEM_RULE'),
	CONSTRAINT "entitlement_resolutions_source_pair_ck" CHECK (("entitlement_resolutions"."selected_source_type" is null) = ("entitlement_resolutions"."selected_source_id" is null))
);
--> statement-breakpoint
CREATE TABLE "entitlement_usage_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"entry_type" varchar(24) NOT NULL,
	"quantity" integer NOT NULL,
	"available_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"business_key" varchar(160) NOT NULL,
	"reservation_id" uuid,
	"consumption_intent_id" uuid,
	"business_context_type" varchar(64),
	"business_context_id" varchar(128),
	"original_entry_id" uuid,
	"operator_adjustment_id" uuid,
	"request_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_usage_entries_type_ck" CHECK ("entitlement_usage_entries"."entry_type" in ('GRANT', 'RESERVE', 'COMMIT', 'RELEASE', 'REVERSE', 'EXPIRE', 'FREEZE', 'UNFREEZE', 'FORFEIT', 'ADJUSTMENT')),
	CONSTRAINT "entitlement_usage_entries_quantity_ck" CHECK ("entitlement_usage_entries"."quantity" > 0),
	CONSTRAINT "entitlement_usage_entries_balance_ck" CHECK ("entitlement_usage_entries"."available_after" >= 0 and "entitlement_usage_entries"."reserved_after" >= 0),
	CONSTRAINT "entitlement_usage_entries_context_pair_ck" CHECK (("entitlement_usage_entries"."business_context_type" is null) = ("entitlement_usage_entries"."business_context_id" is null))
);
--> statement-breakpoint
CREATE TABLE "fulfillment_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"business_key" varchar(160) NOT NULL,
	"fulfillment_type" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"result_references" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_failure" jsonb,
	"request_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_jobs_status_ck" CHECK ("fulfillment_jobs"."status" in ('PENDING', 'RUNNING', 'SUCCEEDED', 'RETRY_WAIT', 'FAILED', 'COMPENSATING', 'COMPENSATED')),
	CONSTRAINT "fulfillment_jobs_attempt_ck" CHECK ("fulfillment_jobs"."attempt" >= 0 and "fulfillment_jobs"."max_attempts" > 0 and "fulfillment_jobs"."attempt" <= "fulfillment_jobs"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "inbox_consumptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"consumer" varchar(64) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"envelope_version" integer NOT NULL,
	"status" varchar(24) DEFAULT 'PROCESSING' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"failure" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_consumptions_version_ck" CHECK ("inbox_consumptions"."envelope_version" > 0),
	CONSTRAINT "inbox_consumptions_attempt_ck" CHECK ("inbox_consumptions"."attempt" > 0),
	CONSTRAINT "inbox_consumptions_status_ck" CHECK ("inbox_consumptions"."status" in ('PROCESSING', 'RETRY_WAIT', 'COMPLETED', 'DEAD_LETTER'))
);
--> statement-breakpoint
CREATE TABLE "membership_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"sequence" integer NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"source_order_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'QUEUED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"benefits_granted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_periods_sequence_ck" CHECK ("membership_periods"."sequence" > 0),
	CONSTRAINT "membership_periods_status_ck" CHECK ("membership_periods"."status" in ('QUEUED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED')),
	CONSTRAINT "membership_periods_range_ck" CHECK ("membership_periods"."ends_at" > "membership_periods"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "membership_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"current_plan_version_id" uuid NOT NULL,
	"source_order_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"terminated_at" timestamp with time zone,
	"termination_reason" varchar(64),
	"request_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_subscriptions_status_ck" CHECK ("membership_subscriptions"."status" in ('ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED')),
	CONSTRAINT "membership_subscriptions_period_ck" CHECK ("membership_subscriptions"."ends_at" > "membership_subscriptions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "membership_upgrades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"previous_subscription_id" uuid NOT NULL,
	"new_order_id" uuid NOT NULL,
	"new_subscription_id" uuid,
	"status" varchar(24) DEFAULT 'QUOTED' NOT NULL,
	"request_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_upgrades_status_ck" CHECK ("membership_upgrades"."status" in ('QUOTED', 'ORDER_CREATED', 'PAID', 'ACTIVATING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "money_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_number" varchar(64) NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"checkout_quote_id" uuid NOT NULL,
	"offering_version_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"business_context_type" varchar(64),
	"business_context_id" varchar(128),
	"request_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_orders_status_ck" CHECK ("money_orders"."status" in ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID', 'FULFILLING', 'FULFILLED', 'CLOSED', 'REFUNDING', 'REFUNDED', 'EXCEPTION')),
	CONSTRAINT "money_orders_amount_ck" CHECK ("money_orders"."amount_minor" >= 0 and "money_orders"."currency" = 'CNY'),
	CONSTRAINT "money_orders_version_ck" CHECK ("money_orders"."version" >= 0),
	CONSTRAINT "money_orders_context_pair_ck" CHECK (("money_orders"."business_context_type" is null) = ("money_orders"."business_context_id" is null))
);
--> statement-breakpoint
CREATE TABLE "offering_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(24) DEFAULT 'DRAFT' NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"amount_minor" integer NOT NULL,
	"entitlement_spec" jsonb NOT NULL,
	"validity_days" integer,
	"purchase_limit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refund_policy_version" varchar(64) NOT NULL,
	"refund_policy" jsonb NOT NULL,
	"terms_version" varchar(64) NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offering_versions_version_positive_ck" CHECK ("offering_versions"."version" > 0),
	CONSTRAINT "offering_versions_amount_nonnegative_ck" CHECK ("offering_versions"."amount_minor" >= 0),
	CONSTRAINT "offering_versions_validity_positive_ck" CHECK ("offering_versions"."validity_days" is null or "offering_versions"."validity_days" > 0),
	CONSTRAINT "offering_versions_currency_ck" CHECK ("offering_versions"."currency" = 'CNY'),
	CONSTRAINT "offering_versions_status_ck" CHECK ("offering_versions"."status" in ('DRAFT', 'PUBLISHED', 'RETIRED')),
	CONSTRAINT "offering_versions_effective_range_ck" CHECK ("offering_versions"."effective_to" is null or "offering_versions"."effective_from" is null or "offering_versions"."effective_to" > "offering_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "operator_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"ledger_type" varchar(32) NOT NULL,
	"grant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"direction" varchar(16) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"note" text NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"related_order_id" uuid,
	"related_task_id" uuid,
	"request_id" uuid NOT NULL,
	"ledger_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_adjustments_ledger_ck" CHECK ("operator_adjustments"."ledger_type" in ('ENTITLEMENT', 'COMPLIMENTARY_SEED')),
	CONSTRAINT "operator_adjustments_direction_ck" CHECK ("operator_adjustments"."direction" in ('INCREASE', 'DECREASE')),
	CONSTRAINT "operator_adjustments_quantity_ck" CHECK ("operator_adjustments"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"offering_snapshot" jsonb NOT NULL,
	"quote_snapshot" jsonb NOT NULL,
	"refund_policy_snapshot" jsonb NOT NULL,
	"terms_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_attempt_id" varchar(128),
	"status" varchar(24) DEFAULT 'CREATED' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"client_parameters" jsonb,
	"failure" jsonb,
	"request_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"succeeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_status_ck" CHECK ("payment_attempts"."status" in ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'CLOSED')),
	CONSTRAINT "payment_attempts_amount_ck" CHECK ("payment_attempts"."amount_minor" >= 0 and "payment_attempts"."currency" = 'CNY')
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_event_id" varchar(160) NOT NULL,
	"payment_attempt_id" uuid,
	"order_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"signature_verified" boolean NOT NULL,
	"verification_snapshot" jsonb NOT NULL,
	"payload_ciphertext" text,
	"provider_occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"case_type" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"severity" varchar(16) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" varchar(128) NOT NULL,
	"business_key" varchar(160) NOT NULL,
	"expected_snapshot" jsonb NOT NULL,
	"actual_snapshot" jsonb NOT NULL,
	"resolution" jsonb,
	"request_id" uuid,
	"detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_cases_status_ck" CHECK ("reconciliation_cases"."status" in ('OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED')),
	CONSTRAINT "reconciliation_cases_severity_ck" CHECK ("reconciliation_cases"."severity" in ('INFO', 'WARNING', 'CRITICAL'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"business_key" varchar(160) NOT NULL,
	"status" varchar(24) DEFAULT 'REQUESTED' NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"refund_policy_version" varchar(64) NOT NULL,
	"eligibility_snapshot" jsonb NOT NULL,
	"provider_refund_id" varchar(128),
	"request_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_status_ck" CHECK ("refunds"."status" in ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "refunds_amount_ck" CHECK ("refunds"."amount_minor" > 0 and "refunds"."currency" = 'CNY')
);
--> statement-breakpoint
CREATE TABLE "reservation_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"consumption_intent_id" uuid NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"source_reservation_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" varchar(24) DEFAULT 'RESERVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_allocations_quantity_ck" CHECK ("reservation_allocations"."quantity" > 0),
	CONSTRAINT "reservation_allocations_status_ck" CHECK ("reservation_allocations"."status" in ('RESERVED', 'COMMITTED', 'RELEASED'))
);
--> statement-breakpoint
CREATE TABLE "resolution_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resolution_id" uuid NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"priority" integer NOT NULL,
	"available_quantity" integer NOT NULL,
	"required_quantity" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_at" timestamp with time zone NOT NULL,
	"cost_snapshot" jsonb NOT NULL,
	"rule_snapshot" jsonb NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolution_candidates_quantity_ck" CHECK ("resolution_candidates"."priority" > 0 and "resolution_candidates"."available_quantity" >= 0 and "resolution_candidates"."required_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "seed_promotion_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"offering_version_id" uuid NOT NULL,
	"rule_version" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'DRAFT' NOT NULL,
	"identity_constraint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"minimum_seed_balance" integer NOT NULL,
	"reserved_seed_quantity" integer NOT NULL,
	"activity_amount_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"purchase_limit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"restoration_policy" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seed_promotion_rules_status_ck" CHECK ("seed_promotion_rules"."status" in ('DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED')),
	CONSTRAINT "seed_promotion_rules_quantity_ck" CHECK ("seed_promotion_rules"."minimum_seed_balance" >= 0 and "seed_promotion_rules"."reserved_seed_quantity" > 0),
	CONSTRAINT "seed_promotion_rules_amount_ck" CHECK ("seed_promotion_rules"."activity_amount_minor" >= 0 and "seed_promotion_rules"."currency" = 'CNY'),
	CONSTRAINT "seed_promotion_rules_range_ck" CHECK ("seed_promotion_rules"."ends_at" > "seed_promotion_rules"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "service_offerings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"business_space" varchar(32) NOT NULL,
	"service_type" varchar(64) NOT NULL,
	"offering_kind" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'DRAFT' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_offerings_status_ck" CHECK ("service_offerings"."status" in ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "upgrade_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upgrade_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"previous_subscription_id" uuid NOT NULL,
	"remaining_time_basis_points" integer NOT NULL,
	"remaining_quota_basis_points" integer NOT NULL,
	"residual_value_estimate_minor" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"assessment_rule_version" varchar(64) NOT NULL,
	"internal_only" boolean DEFAULT true NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upgrade_assessments_ratios_ck" CHECK ("upgrade_assessments"."remaining_time_basis_points" between 0 and 10000 and "upgrade_assessments"."remaining_quota_basis_points" between 0 and 10000),
	CONSTRAINT "upgrade_assessments_value_ck" CHECK ("upgrade_assessments"."residual_value_estimate_minor" >= 0 and "upgrade_assessments"."currency" = 'CNY'),
	CONSTRAINT "upgrade_assessments_internal_only_ck" CHECK ("upgrade_assessments"."internal_only" = true)
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "envelope_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "producer" varchar(64) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "correlation_id" varchar(128);--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "causation_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "last_failure" jsonb;--> statement-breakpoint
ALTER TABLE "checkout_quotes" ADD CONSTRAINT "checkout_quotes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_quotes" ADD CONSTRAINT "checkout_quotes_offering_version_id_offering_versions_id_fk" FOREIGN KEY ("offering_version_id") REFERENCES "public"."offering_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_quotes" ADD CONSTRAINT "checkout_quotes_seed_promotion_rule_id_seed_promotion_rules_id_fk" FOREIGN KEY ("seed_promotion_rule_id") REFERENCES "public"."seed_promotion_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_seed_account_projections" ADD CONSTRAINT "complimentary_seed_account_projections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_seed_allocations" ADD CONSTRAINT "complimentary_seed_allocations_grant_id_complimentary_seed_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."complimentary_seed_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_seed_allocations" ADD CONSTRAINT "complimentary_seed_allocations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_seed_entries" ADD CONSTRAINT "complimentary_seed_entries_grant_id_complimentary_seed_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."complimentary_seed_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_seed_entries" ADD CONSTRAINT "complimentary_seed_entries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_seed_entries" ADD CONSTRAINT "complimentary_seed_entries_original_entry_id_complimentary_seed_entries_id_fk" FOREIGN KEY ("original_entry_id") REFERENCES "public"."complimentary_seed_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_seed_grants" ADD CONSTRAINT "complimentary_seed_grants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_intents" ADD CONSTRAINT "consumption_intents_resolution_id_entitlement_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."entitlement_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_intents" ADD CONSTRAINT "consumption_intents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_resolutions" ADD CONSTRAINT "entitlement_resolutions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_usage_entries" ADD CONSTRAINT "entitlement_usage_entries_grant_id_entitlement_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."entitlement_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_usage_entries" ADD CONSTRAINT "entitlement_usage_entries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_usage_entries" ADD CONSTRAINT "entitlement_usage_entries_original_entry_id_entitlement_usage_entries_id_fk" FOREIGN KEY ("original_entry_id") REFERENCES "public"."entitlement_usage_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_jobs" ADD CONSTRAINT "fulfillment_jobs_order_id_money_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_jobs" ADD CONSTRAINT "fulfillment_jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_periods" ADD CONSTRAINT "membership_periods_subscription_id_membership_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."membership_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_periods" ADD CONSTRAINT "membership_periods_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_periods" ADD CONSTRAINT "membership_periods_plan_version_id_offering_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."offering_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_periods" ADD CONSTRAINT "membership_periods_source_order_id_money_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_current_plan_version_id_offering_versions_id_fk" FOREIGN KEY ("current_plan_version_id") REFERENCES "public"."offering_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_source_order_id_money_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_upgrades" ADD CONSTRAINT "membership_upgrades_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_upgrades" ADD CONSTRAINT "membership_upgrades_previous_subscription_id_membership_subscriptions_id_fk" FOREIGN KEY ("previous_subscription_id") REFERENCES "public"."membership_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_upgrades" ADD CONSTRAINT "membership_upgrades_new_order_id_money_orders_id_fk" FOREIGN KEY ("new_order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_upgrades" ADD CONSTRAINT "membership_upgrades_new_subscription_id_membership_subscriptions_id_fk" FOREIGN KEY ("new_subscription_id") REFERENCES "public"."membership_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_orders" ADD CONSTRAINT "money_orders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_orders" ADD CONSTRAINT "money_orders_checkout_quote_id_checkout_quotes_id_fk" FOREIGN KEY ("checkout_quote_id") REFERENCES "public"."checkout_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_orders" ADD CONSTRAINT "money_orders_offering_version_id_offering_versions_id_fk" FOREIGN KEY ("offering_version_id") REFERENCES "public"."offering_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offering_versions" ADD CONSTRAINT "offering_versions_offering_id_service_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."service_offerings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_adjustments" ADD CONSTRAINT "operator_adjustments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_adjustments" ADD CONSTRAINT "operator_adjustments_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_adjustments" ADD CONSTRAINT "operator_adjustments_related_order_id_money_orders_id_fk" FOREIGN KEY ("related_order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_snapshots" ADD CONSTRAINT "order_snapshots_order_id_money_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_money_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_money_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_money_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."money_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_allocations" ADD CONSTRAINT "reservation_allocations_consumption_intent_id_consumption_intents_id_fk" FOREIGN KEY ("consumption_intent_id") REFERENCES "public"."consumption_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_candidates" ADD CONSTRAINT "resolution_candidates_resolution_id_entitlement_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."entitlement_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_promotion_rules" ADD CONSTRAINT "seed_promotion_rules_offering_version_id_offering_versions_id_fk" FOREIGN KEY ("offering_version_id") REFERENCES "public"."offering_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_assessments" ADD CONSTRAINT "upgrade_assessments_upgrade_id_membership_upgrades_id_fk" FOREIGN KEY ("upgrade_id") REFERENCES "public"."membership_upgrades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_assessments" ADD CONSTRAINT "upgrade_assessments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_assessments" ADD CONSTRAINT "upgrade_assessments_previous_subscription_id_membership_subscriptions_id_fk" FOREIGN KEY ("previous_subscription_id") REFERENCES "public"."membership_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_quotes_owner_cursor_idx" ON "checkout_quotes" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "checkout_quotes_expiry_idx" ON "checkout_quotes" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "complimentary_seed_allocations_reservation_grant_uq" ON "complimentary_seed_allocations" USING btree ("reservation_id","grant_id");--> statement-breakpoint
CREATE INDEX "complimentary_seed_allocations_intent_idx" ON "complimentary_seed_allocations" USING btree ("consumption_intent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "complimentary_seed_entries_business_uq" ON "complimentary_seed_entries" USING btree ("grant_id","entry_type","business_key");--> statement-breakpoint
CREATE INDEX "complimentary_seed_entries_owner_cursor_idx" ON "complimentary_seed_entries" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "complimentary_seed_entries_intent_idx" ON "complimentary_seed_entries" USING btree ("consumption_intent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "complimentary_seed_grants_source_uq" ON "complimentary_seed_grants" USING btree ("owner_user_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "complimentary_seed_grants_candidate_idx" ON "complimentary_seed_grants" USING btree ("owner_user_id","business_space","status","expires_at","granted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "consumption_intents_resolution_uq" ON "consumption_intents" USING btree ("resolution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consumption_intents_context_uq" ON "consumption_intents" USING btree ("business_space","business_context_type","business_context_id");--> statement-breakpoint
CREATE INDEX "consumption_intents_timeout_idx" ON "consumption_intents" USING btree ("status","reservation_deadline");--> statement-breakpoint
CREATE INDEX "consumption_intents_owner_cursor_idx" ON "consumption_intents" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_source_uq" ON "entitlement_grants" USING btree ("source_type","source_id","service_type");--> statement-breakpoint
CREATE INDEX "entitlement_grants_candidate_idx" ON "entitlement_grants" USING btree ("owner_user_id","business_space","service_type","status","expires_at","granted_at","id");--> statement-breakpoint
CREATE INDEX "entitlement_resolutions_context_idx" ON "entitlement_resolutions" USING btree ("business_context_type","business_context_id","created_at");--> statement-breakpoint
CREATE INDEX "entitlement_resolutions_owner_cursor_idx" ON "entitlement_resolutions" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_usage_entries_business_uq" ON "entitlement_usage_entries" USING btree ("grant_id","entry_type","business_key");--> statement-breakpoint
CREATE INDEX "entitlement_usage_entries_owner_cursor_idx" ON "entitlement_usage_entries" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "entitlement_usage_entries_intent_idx" ON "entitlement_usage_entries" USING btree ("consumption_intent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_jobs_business_key_uq" ON "fulfillment_jobs" USING btree ("business_key");--> statement-breakpoint
CREATE INDEX "fulfillment_jobs_retry_idx" ON "fulfillment_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "fulfillment_jobs_order_idx" ON "fulfillment_jobs" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_consumptions_event_consumer_uq" ON "inbox_consumptions" USING btree ("event_id","consumer");--> statement-breakpoint
CREATE INDEX "inbox_consumptions_retry_idx" ON "inbox_consumptions" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_periods_subscription_sequence_uq" ON "membership_periods" USING btree ("subscription_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_periods_source_order_uq" ON "membership_periods" USING btree ("source_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_periods_one_active_uq" ON "membership_periods" USING btree ("owner_user_id","business_space") WHERE "membership_periods"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "membership_periods_activation_idx" ON "membership_periods" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "membership_periods_subscription_queue_idx" ON "membership_periods" USING btree ("subscription_id","starts_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_subscriptions_source_order_uq" ON "membership_subscriptions" USING btree ("source_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_subscriptions_one_active_uq" ON "membership_subscriptions" USING btree ("owner_user_id","business_space") WHERE "membership_subscriptions"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "membership_subscriptions_owner_cursor_idx" ON "membership_subscriptions" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_upgrades_new_order_uq" ON "membership_upgrades" USING btree ("new_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_upgrades_new_subscription_uq" ON "membership_upgrades" USING btree ("new_subscription_id") WHERE "membership_upgrades"."new_subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "membership_upgrades_owner_cursor_idx" ON "membership_upgrades" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "money_orders_number_uq" ON "money_orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "money_orders_quote_uq" ON "money_orders" USING btree ("checkout_quote_id");--> statement-breakpoint
CREATE INDEX "money_orders_owner_cursor_idx" ON "money_orders" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "money_orders_timeout_idx" ON "money_orders" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "money_orders_context_idx" ON "money_orders" USING btree ("business_context_type","business_context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offering_versions_offering_version_uq" ON "offering_versions" USING btree ("offering_id","version");--> statement-breakpoint
CREATE INDEX "offering_versions_publish_idx" ON "offering_versions" USING btree ("offering_id","status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_adjustments_request_uq" ON "operator_adjustments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "operator_adjustments_owner_cursor_idx" ON "operator_adjustments" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "operator_adjustments_operator_idx" ON "operator_adjustments" USING btree ("operator_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_snapshots_order_uq" ON "order_snapshots" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_id_uq" ON "payment_attempts" USING btree ("provider","provider_attempt_id") WHERE "payment_attempts"."provider_attempt_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_success_per_order_uq" ON "payment_attempts" USING btree ("order_id") WHERE "payment_attempts"."status" = 'SUCCEEDED';--> statement-breakpoint
CREATE INDEX "payment_attempts_order_cursor_idx" ON "payment_attempts" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_uq" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_events_order_idx" ON "payment_events" USING btree ("order_id","received_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_cases_business_key_uq" ON "reconciliation_cases" USING btree ("case_type","business_key");--> statement-breakpoint
CREATE INDEX "reconciliation_cases_open_idx" ON "reconciliation_cases" USING btree ("status","severity","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_business_key_uq" ON "refunds" USING btree ("business_key");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_id_uq" ON "refunds" USING btree ("provider_refund_id") WHERE "refunds"."provider_refund_id" is not null;--> statement-breakpoint
CREATE INDEX "refunds_owner_cursor_idx" ON "refunds" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_allocations_source_reservation_uq" ON "reservation_allocations" USING btree ("source_type","source_reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_allocations_intent_idx" ON "reservation_allocations" USING btree ("consumption_intent_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "resolution_candidates_source_uq" ON "resolution_candidates" USING btree ("resolution_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resolution_candidates_priority_uq" ON "resolution_candidates" USING btree ("resolution_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "resolution_candidates_one_selected_uq" ON "resolution_candidates" USING btree ("resolution_id") WHERE "resolution_candidates"."selected" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "seed_promotion_rules_version_uq" ON "seed_promotion_rules" USING btree ("business_space","offering_version_id","rule_version");--> statement-breakpoint
CREATE INDEX "seed_promotion_rules_active_idx" ON "seed_promotion_rules" USING btree ("business_space","status","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_offerings_space_code_uq" ON "service_offerings" USING btree ("business_space","code");--> statement-breakpoint
CREATE INDEX "service_offerings_catalog_idx" ON "service_offerings" USING btree ("business_space","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "upgrade_assessments_upgrade_uq" ON "upgrade_assessments" USING btree ("upgrade_id");--> statement-breakpoint
CREATE INDEX "upgrade_assessments_subscription_idx" ON "upgrade_assessments" USING btree ("previous_subscription_id","created_at");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_envelope_version_ck" CHECK ("outbox"."envelope_version" > 0);