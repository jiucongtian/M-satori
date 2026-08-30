CREATE TABLE "profile_first_look_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"profile_revision_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'GENERATING' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"run_reference" varchar(128) NOT NULL,
	"content" jsonb,
	"generation_manifest" jsonb,
	"provider_request_id" varchar(128),
	"provider_execution_id" varchar(128),
	"duration_ms" integer,
	"failure" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_first_look_reports" ADD CONSTRAINT "profile_first_look_reports_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_first_look_reports" ADD CONSTRAINT "profile_first_look_reports_profile_revision_id_life_profile_revisions_id_fk" FOREIGN KEY ("profile_revision_id") REFERENCES "public"."life_profile_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_first_look_reports_revision_uq" ON "profile_first_look_reports" USING btree ("profile_revision_id");--> statement-breakpoint
CREATE INDEX "profile_first_look_reports_owner_idx" ON "profile_first_look_reports" USING btree ("owner_user_id","created_at");