CREATE TABLE "analytics_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_name" varchar(128) NOT NULL,
	"schema_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"environment" varchar(16) NOT NULL,
	"release" varchar(32) NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"commit_sha" varchar(64),
	"anonymous_id" varchar(128) NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"user_id" uuid,
	"page_code" varchar(64),
	"route" varchar(240),
	"source_page" varchar(64),
	"object_type" varchar(64),
	"object_id" varchar(128),
	"result" varchar(16),
	"reason_code" varchar(96),
	"request_id" uuid,
	"entry" varchar(64),
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_version" varchar(64),
	"device" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_event_name_time_idx" ON "analytics_events" USING btree ("event_name","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_user_time_idx" ON "analytics_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_session_time_idx" ON "analytics_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_received_time_idx" ON "analytics_events" USING btree ("received_at");