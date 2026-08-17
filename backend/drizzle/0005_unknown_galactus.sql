CREATE TABLE "daily_energy_home_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"profile_revision_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"workflow_version" varchar(128) NOT NULL,
	"content" jsonb NOT NULL,
	"provider_request_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_energy_home_summaries" ADD CONSTRAINT "daily_energy_home_summaries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_energy_home_summaries" ADD CONSTRAINT "daily_energy_home_summaries_profile_revision_id_life_profile_revisions_id_fk" FOREIGN KEY ("profile_revision_id") REFERENCES "public"."life_profile_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_energy_home_summaries_identity_uq" ON "daily_energy_home_summaries" USING btree ("owner_user_id","local_date","workflow_version");--> statement-breakpoint
CREATE INDEX "daily_energy_home_summaries_owner_date_idx" ON "daily_energy_home_summaries" USING btree ("owner_user_id","local_date");