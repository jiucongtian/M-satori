DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "seed_accounts" legacy
    WHERE (legacy."available" <> 0 OR legacy."reserved" <> 0 OR legacy."total_earned" <> 0 OR legacy."total_spent" <> 0)
      AND NOT EXISTS (
        SELECT 1
        FROM "complimentary_seed_account_projections" current_account
        WHERE current_account."owner_user_id" = legacy."user_id"
      )
  ) THEN
    RAISE EXCEPTION 'legacy seed accounts still require current account projections';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "daily_insights"
    WHERE "status" IN ('PENDING', 'GENERATING')
      AND "consumption_intent_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy daily insight reservations still require settlement';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "seed_reservation_entry_id";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "seed_settlement_entry_id";--> statement-breakpoint
ALTER TABLE "registration_rewards" DROP COLUMN "seed_entry_id";--> statement-breakpoint
DROP TABLE "seed_entries";--> statement-breakpoint
DROP TABLE "seed_accounts";--> statement-breakpoint
DROP TYPE "public"."seed_entry_type";
