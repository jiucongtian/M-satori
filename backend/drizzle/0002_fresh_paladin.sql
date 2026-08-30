DROP INDEX "idempotency_scope_key_uq";--> statement-breakpoint
ALTER TABLE "idempotency_records" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN "actor_key" varchar(160) NOT NULL;--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "phone_masked" varchar(32);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_hash" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_challenges" ADD COLUMN "phone_ciphertext" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_challenges" ADD COLUMN "phone_masked" varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_challenges" ADD COLUMN "device_hash" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_challenges" ADD COLUMN "ip_hash" varchar(128) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_uq" ON "idempotency_records" USING btree ("actor_key","operation","idempotency_key");