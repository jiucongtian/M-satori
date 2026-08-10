CREATE TYPE "public"."daily_insight_status" AS ENUM('PENDING', 'GENERATING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."revision_status" AS ENUM('CALCULATED', 'ACTIVE', 'SUPERSEDED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."seed_entry_type" AS ENUM('GRANT', 'RESERVE', 'CONSUME', 'RELEASE', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('SELF', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."generation_task_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "astrology_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"algorithm_version" varchar(64) NOT NULL,
	"input_fingerprint" varchar(128) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(128) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" uuid,
	"request_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"position" varchar(16) NOT NULL,
	"pillar" varchar(16) NOT NULL,
	"card_id" varchar(64) NOT NULL,
	"card_version" varchar(32) NOT NULL,
	"knowledge_version" varchar(32) NOT NULL,
	"rules_version" varchar(32) NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" varchar(64) NOT NULL,
	"document_version" varchar(32) NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"evidence" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_insights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"profile_revision_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"content_policy_version" varchar(64) NOT NULL,
	"status" "daily_insight_status" DEFAULT 'PENDING' NOT NULL,
	"content" jsonb,
	"generation_manifest" jsonb,
	"seed_reservation_entry_id" uuid,
	"seed_settlement_entry_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"impact_snapshot" jsonb NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"cancellable_until" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"reason" varchar(64),
	"comment_ciphertext" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_rating_range" CHECK ("feedback"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "generation_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"provider_run_id" varchar(128),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" uuid NOT NULL,
	"status" "generation_task_status" DEFAULT 'QUEUED' NOT NULL,
	"stage" varchar(64) DEFAULT 'QUEUED' NOT NULL,
	"current_attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"failure" jsonb,
	"heartbeat_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "life_profile_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" varchar(128) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_subject_hash" varchar(128) NOT NULL,
	"phone_ciphertext" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "life_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"group_id" uuid,
	"relationship_type" varchar(32) NOT NULL,
	"active_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "location_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_location_id" varchar(128) NOT NULL,
	"display_name" varchar(256) NOT NULL,
	"latitude_microdegrees" integer NOT NULL,
	"longitude_microdegrees" integer NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locale" varchar(16) DEFAULT 'zh-CN' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_rewards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"reward_type" varchar(64) NOT NULL,
	"amount" integer NOT NULL,
	"status" varchar(24) DEFAULT 'AVAILABLE' NOT NULL,
	"seed_entry_id" uuid,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "life_profile_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "revision_status" NOT NULL,
	"input_fingerprint" varchar(128) NOT NULL,
	"birth_data_ciphertext" text NOT NULL,
	"location_snapshot_id" uuid NOT NULL,
	"astrology_snapshot_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"total_earned" bigint DEFAULT 0 NOT NULL,
	"total_spent" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seed_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "seed_accounts_nonnegative" CHECK ("seed_accounts"."available" >= 0 and "seed_accounts"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seed_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "seed_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"available_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"business_key" varchar(160) NOT NULL,
	"business_type" varchar(64) NOT NULL,
	"resource_id" uuid,
	"original_entry_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone_hash" varchar(128) NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"code_hash" varchar(128) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_challenges_attempts_nonnegative" CHECK ("sms_challenges"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"type" "subject_type" NOT NULL,
	"display_name_ciphertext" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_task_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
	"locale" varchar(16) DEFAULT 'zh-CN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_bindings" ADD CONSTRAINT "card_bindings_revision_id_life_profile_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."life_profile_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_profile_revision_id_life_profile_revisions_id_fk" FOREIGN KEY ("profile_revision_id") REFERENCES "public"."life_profile_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_seed_reservation_entry_id_seed_entries_id_fk" FOREIGN KEY ("seed_reservation_entry_id") REFERENCES "public"."seed_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_seed_settlement_entry_id_seed_entries_id_fk" FOREIGN KEY ("seed_settlement_entry_id") REFERENCES "public"."seed_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_task_id_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_profile_groups" ADD CONSTRAINT "life_profile_groups_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_profiles" ADD CONSTRAINT "life_profiles_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_profiles" ADD CONSTRAINT "life_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_profiles" ADD CONSTRAINT "life_profiles_group_id_life_profile_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."life_profile_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_rewards" ADD CONSTRAINT "registration_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_rewards" ADD CONSTRAINT "registration_rewards_seed_entry_id_seed_entries_id_fk" FOREIGN KEY ("seed_entry_id") REFERENCES "public"."seed_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_profile_revisions" ADD CONSTRAINT "life_profile_revisions_profile_id_life_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."life_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_profile_revisions" ADD CONSTRAINT "life_profile_revisions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_profile_revisions" ADD CONSTRAINT "life_profile_revisions_location_snapshot_id_location_snapshots_id_fk" FOREIGN KEY ("location_snapshot_id") REFERENCES "public"."location_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_profile_revisions" ADD CONSTRAINT "life_profile_revisions_astrology_snapshot_id_astrology_snapshots_id_fk" FOREIGN KEY ("astrology_snapshot_id") REFERENCES "public"."astrology_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_accounts" ADD CONSTRAINT "seed_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_entries" ADD CONSTRAINT "seed_entries_account_id_seed_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."seed_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_task_events" ADD CONSTRAINT "generation_task_events_task_id_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."generation_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_bindings_revision_position_uq" ON "card_bindings" USING btree ("revision_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_user_document_version_uq" ON "consent_records" USING btree ("user_id","document_id","document_version");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_insights_identity_uq" ON "daily_insights" USING btree ("subject_id","local_date","timezone","content_policy_version");--> statement-breakpoint
CREATE INDEX "daily_insights_owner_date_idx" ON "daily_insights" USING btree ("owner_user_id","local_date","id");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_requests_one_active_uq" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" in ('PENDING', 'PROCESSING');--> statement-breakpoint
CREATE INDEX "feedback_target_idx" ON "feedback" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_attempts_task_number_uq" ON "generation_attempts" USING btree ("task_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_tasks_target_uq" ON "generation_tasks" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "generation_tasks_owner_idx" ON "generation_tasks" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_owner_name_uq" ON "life_profile_groups" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "groups_owner_sort_idx" ON "life_profile_groups" USING btree ("owner_user_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_uq" ON "idempotency_records" USING btree ("user_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_subject_uq" ON "identities" USING btree ("provider","provider_subject_hash");--> statement-breakpoint
CREATE INDEX "identities_user_idx" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "life_profiles_subject_uq" ON "life_profiles" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "life_profiles_owner_cursor_idx" ON "life_profiles" USING btree ("owner_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("published_at","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_rewards_user_type_uq" ON "registration_rewards" USING btree ("user_id","reward_type");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_profile_sequence_uq" ON "life_profile_revisions" USING btree ("profile_id","sequence");--> statement-breakpoint
CREATE INDEX "revisions_owner_profile_idx" ON "life_profile_revisions" USING btree ("owner_user_id","profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seed_entries_business_uq" ON "seed_entries" USING btree ("account_id","type","business_key");--> statement-breakpoint
CREATE INDEX "seed_entries_account_cursor_idx" ON "seed_entries" USING btree ("account_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_hash_uq" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_family_idx" ON "sessions" USING btree ("user_id","family_id");--> statement-breakpoint
CREATE INDEX "sms_challenges_phone_purpose_idx" ON "sms_challenges" USING btree ("phone_hash","purpose","created_at");--> statement-breakpoint
CREATE INDEX "subjects_owner_idx" ON "subjects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_one_self_uq" ON "subjects" USING btree ("owner_user_id") WHERE "subjects"."type" = 'SELF' and "subjects"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_events_task_sequence_uq" ON "generation_task_events" USING btree ("task_id","sequence");