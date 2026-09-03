ALTER TABLE "card_readings" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "card_readings" ADD COLUMN "generation_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "card_readings" ADD COLUMN "provider_request_id" varchar(128);--> statement-breakpoint
ALTER TABLE "card_readings" ADD COLUMN "generation_started_at" timestamp with time zone;
