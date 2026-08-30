CREATE TABLE "card_catalog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deck_id" uuid NOT NULL,
	"card_number" integer NOT NULL,
	"card_code" varchar(32) NOT NULL,
	"ganzhi" varchar(8) NOT NULL,
	"zodiac" varchar(8) NOT NULL,
	"season" varchar(16) NOT NULL,
	"talent_mark" varchar(32) NOT NULL,
	"ability_mark" varchar(16) NOT NULL,
	"journey_mark" varchar(32) NOT NULL,
	"asset_path" varchar(128) NOT NULL,
	"alt_text" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_decks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"version" varchar(32) NOT NULL,
	"name" varchar(80) NOT NULL,
	"asset_base_url" varchar(255) NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_catalog" ADD CONSTRAINT "card_catalog_deck_id_card_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."card_decks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_catalog_deck_number_uq" ON "card_catalog" USING btree ("deck_id","card_number");--> statement-breakpoint
CREATE UNIQUE INDEX "card_catalog_deck_code_uq" ON "card_catalog" USING btree ("deck_id","card_code");--> statement-breakpoint
CREATE UNIQUE INDEX "card_catalog_deck_ganzhi_uq" ON "card_catalog" USING btree ("deck_id","ganzhi");--> statement-breakpoint
CREATE UNIQUE INDEX "card_decks_code_version_uq" ON "card_decks" USING btree ("code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "card_decks_one_active_uq" ON "card_decks" USING btree ("status") WHERE "card_decks"."status" = 'ACTIVE';