import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const id = (name = 'id') => uuid(name).primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const subjectType = pgEnum('subject_type', ['SELF', 'OTHER']);
export const revisionStatus = pgEnum('revision_status', ['CALCULATED', 'ACTIVE', 'SUPERSEDED', 'EXPIRED']);
export const taskStatus = pgEnum('generation_task_status', [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);
export const seedEntryType = pgEnum('seed_entry_type', [
  'GRANT',
  'RESERVE',
  'CONSUME',
  'RELEASE',
  'REFUND',
  'ADJUSTMENT',
]);
export const dailyInsightStatus = pgEnum('daily_insight_status', [
  'PENDING',
  'GENERATING',
  'READY',
  'FAILED',
]);

export const users = pgTable('users', {
  id: id(),
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
  locale: varchar('locale', { length: 16 }).notNull().default('zh-CN'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const identities = pgTable(
  'identities',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerSubjectHash: varchar('provider_subject_hash', { length: 128 }).notNull(),
    phoneCiphertext: text('phone_ciphertext'),
    phoneMasked: varchar('phone_masked', { length: 32 }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('identities_provider_subject_uq').on(table.provider, table.providerSubjectHash),
    index('identities_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: varchar('refresh_token_hash', { length: 128 }).notNull(),
    deviceHash: varchar('device_hash', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBySessionId: uuid('replaced_by_session_id'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sessions_refresh_hash_uq').on(table.refreshTokenHash),
    index('sessions_user_family_idx').on(table.userId, table.familyId),
  ],
);

export const smsChallenges = pgTable(
  'sms_challenges',
  {
    id: id(),
    phoneHash: varchar('phone_hash', { length: 128 }).notNull(),
    phoneCiphertext: text('phone_ciphertext').notNull(),
    phoneMasked: varchar('phone_masked', { length: 32 }).notNull(),
    deviceHash: varchar('device_hash', { length: 128 }).notNull(),
    ipHash: varchar('ip_hash', { length: 128 }).notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    codeHash: varchar('code_hash', { length: 128 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('sms_challenges_phone_purpose_idx').on(table.phoneHash, table.purpose, table.createdAt),
    check('sms_challenges_attempts_nonnegative', sql`${table.attempts} >= 0`),
  ],
);

export const consentRecords = pgTable(
  'consent_records',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    documentId: varchar('document_id', { length: 64 }).notNull(),
    documentVersion: varchar('document_version', { length: 32 }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull(),
    evidence: jsonb('evidence').notNull(),
  },
  (table) => [
    uniqueIndex('consent_user_document_version_uq').on(table.userId, table.documentId, table.documentVersion),
  ],
);

export const preferences = pgTable('preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  locale: varchar('locale', { length: 16 }).notNull().default('zh-CN'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'),
  updatedAt: updatedAt(),
});

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id),
    actorKey: varchar('actor_key', { length: 160 }).notNull(),
    operation: varchar('operation', { length: 128 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    requestHash: varchar('request_hash', { length: 128 }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('idempotency_scope_key_uq').on(table.actorKey, table.operation, table.idempotencyKey),
    index('idempotency_expiry_idx').on(table.expiresAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: varchar('action', { length: 128 }).notNull(),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    resourceId: uuid('resource_id'),
    requestId: uuid('request_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index('audit_resource_idx').on(table.resourceType, table.resourceId, table.createdAt)],
);

export const legalDocuments = pgTable(
  'legal_documents',
  {
    documentId: varchar('document_id', { length: 64 }).primaryKey(),
    type: varchar('type', { length: 32 }).notNull(),
    version: varchar('version', { length: 32 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    required: boolean('required').notNull().default(true),
    contentFormat: varchar('content_format', { length: 16 }).notNull().default('MARKDOWN'),
    content: text('content').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('legal_documents_type_version_uq').on(table.type, table.version)],
);

export const subjects = pgTable(
  'subjects',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    type: subjectType('type').notNull(),
    displayNameCiphertext: text('display_name_ciphertext').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('subjects_owner_idx').on(table.ownerUserId),
    uniqueIndex('subjects_one_self_uq')
      .on(table.ownerUserId)
      .where(sql`${table.type} = 'SELF' and ${table.deletedAt} is null`),
  ],
);

export const groups = pgTable(
  'life_profile_groups',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('groups_owner_name_uq').on(table.ownerUserId, table.name),
    index('groups_owner_sort_idx').on(table.ownerUserId, table.sortOrder),
  ],
);

export const lifeProfiles = pgTable(
  'life_profiles',
  {
    id: id(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
    relationshipType: varchar('relationship_type', { length: 32 }).notNull(),
    activeRevisionId: uuid('active_revision_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('life_profiles_subject_uq').on(table.subjectId),
    index('life_profiles_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
  ],
);

export const locationSnapshots = pgTable('location_snapshots', {
  id: id(),
  provider: varchar('provider', { length: 32 }).notNull(),
  providerLocationId: varchar('provider_location_id', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 256 }).notNull(),
  latitudeMicrodegrees: integer('latitude_microdegrees').notNull(),
  longitudeMicrodegrees: integer('longitude_microdegrees').notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: createdAt(),
});

export const astrologySnapshots = pgTable('astrology_snapshots', {
  id: id(),
  algorithmVersion: varchar('algorithm_version', { length: 64 }).notNull(),
  inputFingerprint: varchar('input_fingerprint', { length: 128 }).notNull(),
  result: jsonb('result').notNull(),
  createdAt: createdAt(),
});

export const revisions = pgTable(
  'life_profile_revisions',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => lifeProfiles.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    sequence: integer('sequence').notNull(),
    status: revisionStatus('status').notNull(),
    inputFingerprint: varchar('input_fingerprint', { length: 128 }).notNull(),
    birthDataCiphertext: text('birth_data_ciphertext').notNull(),
    locationSnapshotId: uuid('location_snapshot_id')
      .notNull()
      .references(() => locationSnapshots.id),
    astrologySnapshotId: uuid('astrology_snapshot_id')
      .notNull()
      .references(() => astrologySnapshots.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('revisions_profile_sequence_uq').on(table.profileId, table.sequence),
    index('revisions_owner_profile_idx').on(table.ownerUserId, table.profileId, table.createdAt),
  ],
);

export const cardBindings = pgTable(
  'card_bindings',
  {
    id: id(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id),
    position: varchar('position', { length: 16 }).notNull(),
    pillar: varchar('pillar', { length: 16 }).notNull(),
    cardId: varchar('card_id', { length: 64 }).notNull(),
    cardVersion: varchar('card_version', { length: 32 }).notNull(),
    knowledgeVersion: varchar('knowledge_version', { length: 32 }).notNull(),
    rulesVersion: varchar('rules_version', { length: 32 }).notNull(),
    snapshot: jsonb('snapshot').notNull(),
  },
  (table) => [uniqueIndex('card_bindings_revision_position_uq').on(table.revisionId, table.position)],
);

export const cardDecks = pgTable(
  'card_decks',
  {
    id: id(),
    code: varchar('code', { length: 64 }).notNull(),
    version: varchar('version', { length: 32 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    assetBaseUrl: varchar('asset_base_url', { length: 255 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('card_decks_code_version_uq').on(table.code, table.version),
    uniqueIndex('card_decks_one_active_uq').on(table.status).where(sql`${table.status} = 'ACTIVE'`),
  ],
);

export const cardCatalog = pgTable(
  'card_catalog',
  {
    id: id(),
    deckId: uuid('deck_id').notNull().references(() => cardDecks.id),
    cardNumber: integer('card_number').notNull(),
    cardCode: varchar('card_code', { length: 32 }).notNull(),
    ganzhi: varchar('ganzhi', { length: 8 }).notNull(),
    zodiac: varchar('zodiac', { length: 8 }).notNull(),
    season: varchar('season', { length: 16 }).notNull(),
    talentMark: varchar('talent_mark', { length: 32 }).notNull(),
    abilityMark: varchar('ability_mark', { length: 16 }).notNull(),
    journeyMark: varchar('journey_mark', { length: 32 }).notNull(),
    assetPath: varchar('asset_path', { length: 128 }).notNull(),
    altText: varchar('alt_text', { length: 160 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('card_catalog_deck_number_uq').on(table.deckId, table.cardNumber),
    uniqueIndex('card_catalog_deck_code_uq').on(table.deckId, table.cardCode),
    uniqueIndex('card_catalog_deck_ganzhi_uq').on(table.deckId, table.ganzhi),
  ],
);

export const seedAccounts = pgTable(
  'seed_accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    available: integer('available').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    totalEarned: bigint('total_earned', { mode: 'number' }).notNull().default(0),
    totalSpent: bigint('total_spent', { mode: 'number' }).notNull().default(0),
    version: integer('version').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [check('seed_accounts_nonnegative', sql`${table.available} >= 0 and ${table.reserved} >= 0`)],
);

export const seedEntries = pgTable(
  'seed_entries',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => seedAccounts.id),
    type: seedEntryType('type').notNull(),
    amount: integer('amount').notNull(),
    availableAfter: integer('available_after').notNull(),
    reservedAfter: integer('reserved_after').notNull(),
    businessKey: varchar('business_key', { length: 160 }).notNull(),
    businessType: varchar('business_type', { length: 64 }).notNull(),
    resourceId: uuid('resource_id'),
    originalEntryId: uuid('original_entry_id').references((): AnyPgColumn => seedEntries.id),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('seed_entries_business_uq').on(table.accountId, table.type, table.businessKey),
    index('seed_entries_account_cursor_idx').on(table.accountId, table.createdAt, table.id),
    check('seed_entries_amount_nonzero', sql`${table.amount} <> 0`),
    check(
      'seed_entries_snapshots_nonnegative',
      sql`${table.availableAfter} >= 0 and ${table.reservedAfter} >= 0`,
    ),
  ],
);

export const registrationRewards = pgTable(
  'registration_rewards',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    rewardType: varchar('reward_type', { length: 64 }).notNull(),
    amount: integer('amount').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('AVAILABLE'),
    seedEntryId: uuid('seed_entry_id').references(() => seedEntries.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('registration_rewards_user_type_uq').on(table.userId, table.rewardType)],
);

export const dailyInsights = pgTable(
  'daily_insights',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    profileRevisionId: uuid('profile_revision_id')
      .notNull()
      .references(() => revisions.id),
    localDate: date('local_date').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    contentPolicyVersion: varchar('content_policy_version', { length: 64 }).notNull(),
    status: dailyInsightStatus('status').notNull().default('PENDING'),
    content: jsonb('content'),
    generationManifest: jsonb('generation_manifest'),
    seedReservationEntryId: uuid('seed_reservation_entry_id').references(() => seedEntries.id),
    seedSettlementEntryId: uuid('seed_settlement_entry_id').references(() => seedEntries.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('daily_insights_identity_uq').on(
      table.subjectId,
      table.localDate,
      table.timezone,
      table.contentPolicyVersion,
    ),
    index('daily_insights_owner_date_idx').on(table.ownerUserId, table.localDate, table.id),
  ],
);

export const generationTasks = pgTable(
  'generation_tasks',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: uuid('target_id').notNull(),
    status: taskStatus('status').notNull().default('QUEUED'),
    stage: varchar('stage', { length: 64 }).notNull().default('QUEUED'),
    currentAttempt: integer('current_attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    failure: jsonb('failure'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('generation_tasks_target_uq').on(table.targetType, table.targetId),
    index('generation_tasks_owner_idx').on(table.ownerUserId, table.createdAt),
  ],
);

export const generationAttempts = pgTable(
  'generation_attempts',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => generationTasks.id),
    attemptNumber: integer('attempt_number').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    providerRunId: varchar('provider_run_id', { length: 128 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    failure: jsonb('failure'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('generation_attempts_task_number_uq').on(table.taskId, table.attemptNumber)],
);

export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    payload: jsonb('payload').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index('outbox_unpublished_idx').on(table.publishedAt, table.availableAt)],
);

export const taskEvents = pgTable(
  'generation_task_events',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => generationTasks.id),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('task_events_task_sequence_uq').on(table.taskId, table.sequence)],
);

export const feedback = pgTable(
  'feedback',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: uuid('target_id').notNull(),
    rating: integer('rating').notNull(),
    reason: varchar('reason', { length: 64 }),
    commentCiphertext: text('comment_ciphertext'),
    createdAt: createdAt(),
  },
  (table) => [
    index('feedback_target_idx').on(table.targetType, table.targetId),
    check('feedback_rating_range', sql`${table.rating} between 1 and 5`),
  ],
);

export const deletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),
    impactSnapshot: jsonb('impact_snapshot').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    cancellableUntil: timestamp('cancellable_until', { withTimezone: true }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('deletion_requests_one_active_uq')
      .on(table.userId)
      .where(sql`${table.status} in ('PENDING', 'PROCESSING')`),
  ],
);

export const dailyEnergyHomeSummaries = pgTable(
  'daily_energy_home_summaries',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    profileRevisionId: uuid('profile_revision_id')
      .notNull()
      .references(() => revisions.id),
    localDate: date('local_date').notNull(),
    workflowVersion: varchar('workflow_version', { length: 128 }).notNull(),
    content: jsonb('content').notNull(),
    providerRequestId: varchar('provider_request_id', { length: 128 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('daily_energy_home_summaries_identity_uq').on(
      table.ownerUserId,
      table.localDate,
      table.workflowVersion,
    ),
    index('daily_energy_home_summaries_owner_date_idx').on(table.ownerUserId, table.localDate),
  ],
);

export const dailyEnergyHomeSummaryCache = pgTable(
  'daily_energy_home_summary_cache',
  {
    id: id(),
    localDate: date('local_date').notNull(),
    dayCard: varchar('day_card', { length: 2 }).notNull(),
    heavenCard: varchar('heaven_card', { length: 2 }).notNull(),
    workflowVersion: varchar('workflow_version', { length: 128 }).notNull(),
    content: jsonb('content').notNull(),
    providerRequestId: varchar('provider_request_id', { length: 128 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('daily_energy_home_summary_cache_identity_uq').on(
      table.localDate,
      table.dayCard,
      table.workflowVersion,
    ),
    index('daily_energy_home_summary_cache_date_idx').on(table.localDate),
  ],
);
