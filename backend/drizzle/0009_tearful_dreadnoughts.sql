ALTER TABLE "checkout_quotes" ADD COLUMN "business_context_type" varchar(64);--> statement-breakpoint
ALTER TABLE "checkout_quotes" ADD COLUMN "business_context_id" varchar(128);--> statement-breakpoint
ALTER TABLE "checkout_quotes" ADD COLUMN "idempotency_key" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_quotes" ADD COLUMN "request_hash" varchar(128) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_quotes_owner_idempotency_uq" ON "checkout_quotes" USING btree ("owner_user_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "checkout_quotes" ADD CONSTRAINT "checkout_quotes_context_pair_ck" CHECK (("checkout_quotes"."business_context_type" is null) = ("checkout_quotes"."business_context_id" is null));