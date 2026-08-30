ALTER TABLE "seed_entries" ADD CONSTRAINT "seed_entries_original_entry_id_seed_entries_id_fk" FOREIGN KEY ("original_entry_id") REFERENCES "public"."seed_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_entries" ADD CONSTRAINT "seed_entries_amount_nonzero" CHECK ("seed_entries"."amount" <> 0);--> statement-breakpoint
ALTER TABLE "seed_entries" ADD CONSTRAINT "seed_entries_snapshots_nonnegative" CHECK ("seed_entries"."available_after" >= 0 and "seed_entries"."reserved_after" >= 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_seed_entry_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'seed_entries is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER seed_entries_append_only
BEFORE UPDATE OR DELETE ON "seed_entries"
FOR EACH ROW EXECUTE FUNCTION reject_seed_entry_mutation();
