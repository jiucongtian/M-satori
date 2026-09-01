CREATE TABLE "card_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"category" varchar(32) NOT NULL,
	"card_count" integer NOT NULL,
	"position_labels" jsonb NOT NULL,
	"card_codes" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'DRAWN' NOT NULL,
	"failure" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_readings_card_count_ck" CHECK ("card_readings"."card_count" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "card_readings" ADD CONSTRAINT "card_readings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_readings_owner_created_idx" ON "card_readings" USING btree ("owner_user_id","created_at","id");