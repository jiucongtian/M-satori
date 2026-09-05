ALTER TABLE "card_readings" ADD COLUMN "request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "card_readings" ADD COLUMN "consumption_intent_id" uuid;--> statement-breakpoint
ALTER TABLE "card_readings" ADD COLUMN "consumption_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_readings" ADD COLUMN "seed_quantity" integer;--> statement-breakpoint
ALTER TABLE "card_readings" ADD COLUMN "seed_cost_rule_version" varchar(64);