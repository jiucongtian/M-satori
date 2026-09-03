ALTER TABLE "operations_pending_benefit_claims" ADD COLUMN IF NOT EXISTS "claim_error" text;--> statement-breakpoint
ALTER TABLE "operations_pending_benefit_claims" DROP CONSTRAINT IF EXISTS "operations_pending_benefit_claims_status_check";--> statement-breakpoint
ALTER TABLE "operations_pending_benefit_claims" DROP CONSTRAINT IF EXISTS "operations_pending_benefit_claims_status_ck";--> statement-breakpoint
ALTER TABLE "operations_pending_benefit_claims" ADD CONSTRAINT "operations_pending_benefit_claims_status_ck" CHECK ("operations_pending_benefit_claims"."status" in ('PENDING_CLAIM','CLAIMED','CLAIM_FAILED','REVOKED'));--> statement-breakpoint
ALTER TABLE "membership_subscriptions" ADD COLUMN IF NOT EXISTS "grant_source" varchar(24) DEFAULT 'PURCHASE' NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_periods" ADD COLUMN IF NOT EXISTS "grant_source" varchar(24) DEFAULT 'PURCHASE' NOT NULL;
