CREATE TABLE "legal_documents" (
	"document_id" varchar(64) PRIMARY KEY NOT NULL,
	"type" varchar(32) NOT NULL,
	"version" varchar(32) NOT NULL,
	"title" varchar(120) NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"content_format" varchar(16) DEFAULT 'MARKDOWN' NOT NULL,
	"content" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_type_version_uq" ON "legal_documents" USING btree ("type","version");