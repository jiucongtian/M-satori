ALTER TABLE "money_orders" ADD COLUMN "promotion_seed_reservation_id" varchar(128);--> statement-breakpoint
ALTER TABLE "money_orders" ADD COLUMN "idempotency_key" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "money_orders" ADD COLUMN "request_hash" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "idempotency_key" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "request_hash" varchar(128) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "money_orders_owner_idempotency_uq" ON "money_orders" USING btree ("owner_user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_owner_idempotency_uq" ON "payment_attempts" USING btree ("owner_user_id","idempotency_key");