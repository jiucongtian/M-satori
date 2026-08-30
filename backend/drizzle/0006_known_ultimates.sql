CREATE TABLE "daily_energy_home_summary_cache" (
	"id" uuid PRIMARY KEY NOT NULL,
	"local_date" date NOT NULL,
	"day_card" varchar(2) NOT NULL,
	"heaven_card" varchar(2) NOT NULL,
	"workflow_version" varchar(128) NOT NULL,
	"content" jsonb NOT NULL,
	"provider_request_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_energy_home_summary_cache_identity_uq" ON "daily_energy_home_summary_cache" USING btree ("local_date","day_card","workflow_version");--> statement-breakpoint
CREATE INDEX "daily_energy_home_summary_cache_date_idx" ON "daily_energy_home_summary_cache" USING btree ("local_date");