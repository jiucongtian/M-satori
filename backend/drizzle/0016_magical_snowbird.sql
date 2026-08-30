CREATE TABLE "operator_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(24) NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "operator_roles_role_ck" CHECK ("operator_roles"."role" in ('ADMIN','FINANCE','SUPPORT'))
);
--> statement-breakpoint
ALTER TABLE "operator_roles" ADD CONSTRAINT "operator_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_roles" ADD CONSTRAINT "operator_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_roles_active_uq" ON "operator_roles" USING btree ("user_id","role") WHERE "operator_roles"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "operator_roles_user_idx" ON "operator_roles" USING btree ("user_id","granted_at");