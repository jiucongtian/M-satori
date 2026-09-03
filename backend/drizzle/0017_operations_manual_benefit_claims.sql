ALTER TABLE "membership_subscriptions" ALTER COLUMN "source_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_periods" ALTER COLUMN "source_order_id" DROP NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operations_pending_benefit_claims" (
  "id" uuid PRIMARY KEY NOT NULL,
  "action_request_id" uuid NOT NULL,
  "phone_hash" varchar(128) NOT NULL,
  "phone_masked" varchar(20) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(24) DEFAULT 'PENDING_CLAIM' NOT NULL,
  "claimed_user_id" uuid,
  "claimed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "operations_pending_benefit_claims_status_ck" CHECK ("operations_pending_benefit_claims"."status" in ('PENDING_CLAIM','CLAIMED','REVOKED')),
  CONSTRAINT "operations_pending_benefit_claims_action_request_uq" UNIQUE("action_request_id")
);
