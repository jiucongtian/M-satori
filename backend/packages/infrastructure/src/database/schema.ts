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

export const profileFirstLookReports = pgTable(
  'profile_first_look_reports',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    profileRevisionId: uuid('profile_revision_id')
      .notNull()
      .references(() => revisions.id),
    status: varchar('status', { length: 24 }).notNull().default('GENERATING'),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    runReference: varchar('run_reference', { length: 128 }).notNull(),
    content: jsonb('content'),
    generationManifest: jsonb('generation_manifest'),
    providerRequestId: varchar('provider_request_id', { length: 128 }),
    providerExecutionId: varchar('provider_execution_id', { length: 128 }),
    durationMs: integer('duration_ms'),
    failure: jsonb('failure'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('profile_first_look_reports_revision_uq').on(table.profileRevisionId),
    index('profile_first_look_reports_owner_idx').on(table.ownerUserId, table.createdAt),
  ],
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
    uniqueIndex('card_decks_one_active_uq')
      .on(table.status)
      .where(sql`${table.status} = 'ACTIVE'`),
  ],
);

export const cardCatalog = pgTable(
  'card_catalog',
  {
    id: id(),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => cardDecks.id),
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
    envelopeVersion: integer('envelope_version').notNull().default(1),
    producer: varchar('producer', { length: 64 }).notNull().default('legacy'),
    requestId: uuid('request_id'),
    correlationId: varchar('correlation_id', { length: 128 }),
    causationId: uuid('causation_id'),
    payload: jsonb('payload').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastFailure: jsonb('last_failure'),
    createdAt: createdAt(),
  },
  (table) => [
    index('outbox_unpublished_idx').on(table.publishedAt, table.availableAt),
    check('outbox_envelope_version_ck', sql`${table.envelopeVersion} > 0`),
  ],
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

// R1.1 commerce catalog and authoritative quote ownership: catalog / pricing.
export const serviceOfferings = pgTable(
  'service_offerings',
  {
    id: id(),
    code: varchar('code', { length: 64 }).notNull(),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    serviceType: varchar('service_type', { length: 64 }).notNull(),
    offeringKind: varchar('offering_kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('DRAFT'),
    currentVersionId: uuid('current_version_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('service_offerings_space_code_uq').on(table.businessSpace, table.code),
    index('service_offerings_catalog_idx').on(table.businessSpace, table.status, table.createdAt),
    check('service_offerings_status_ck', sql`${table.status} in ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')`),
  ],
);

export const offeringVersions = pgTable(
  'offering_versions',
  {
    id: id(),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => serviceOfferings.id),
    version: integer('version').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('DRAFT'),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    description: text('description').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
    amountMinor: integer('amount_minor').notNull(),
    entitlementSpec: jsonb('entitlement_spec').notNull(),
    validityDays: integer('validity_days'),
    purchaseLimit: jsonb('purchase_limit').notNull().default({}),
    refundPolicyVersion: varchar('refund_policy_version', { length: 64 }).notNull(),
    refundPolicy: jsonb('refund_policy').notNull(),
    termsVersion: varchar('terms_version', { length: 64 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('offering_versions_offering_version_uq').on(table.offeringId, table.version),
    index('offering_versions_publish_idx').on(table.offeringId, table.status, table.publishedAt),
    check('offering_versions_version_positive_ck', sql`${table.version} > 0`),
    check('offering_versions_amount_nonnegative_ck', sql`${table.amountMinor} >= 0`),
    check(
      'offering_versions_validity_positive_ck',
      sql`${table.validityDays} is null or ${table.validityDays} > 0`,
    ),
    check('offering_versions_currency_ck', sql`${table.currency} = 'CNY'`),
    check('offering_versions_status_ck', sql`${table.status} in ('DRAFT', 'PUBLISHED', 'RETIRED')`),
    check(
      'offering_versions_effective_range_ck',
      sql`${table.effectiveTo} is null or ${table.effectiveFrom} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const seedPromotionRules = pgTable(
  'seed_promotion_rules',
  {
    id: id(),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    offeringVersionId: uuid('offering_version_id')
      .notNull()
      .references(() => offeringVersions.id),
    ruleVersion: varchar('rule_version', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('DRAFT'),
    identityConstraint: jsonb('identity_constraint').notNull().default({}),
    minimumSeedBalance: integer('minimum_seed_balance').notNull(),
    reservedSeedQuantity: integer('reserved_seed_quantity').notNull(),
    activityAmountMinor: integer('activity_amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
    purchaseLimit: jsonb('purchase_limit').notNull().default({}),
    restorationPolicy: jsonb('restoration_policy').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('seed_promotion_rules_version_uq').on(
      table.businessSpace,
      table.offeringVersionId,
      table.ruleVersion,
    ),
    index('seed_promotion_rules_active_idx').on(
      table.businessSpace,
      table.status,
      table.startsAt,
      table.endsAt,
    ),
    check(
      'seed_promotion_rules_status_ck',
      sql`${table.status} in ('DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED')`,
    ),
    check(
      'seed_promotion_rules_quantity_ck',
      sql`${table.minimumSeedBalance} >= 0 and ${table.reservedSeedQuantity} > 0`,
    ),
    check(
      'seed_promotion_rules_amount_ck',
      sql`${table.activityAmountMinor} >= 0 and ${table.currency} = 'CNY'`,
    ),
    check('seed_promotion_rules_range_ck', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const checkoutQuotes = pgTable(
  'checkout_quotes',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    offeringVersionId: uuid('offering_version_id')
      .notNull()
      .references(() => offeringVersions.id),
    seedPromotionRuleId: uuid('seed_promotion_rule_id').references(() => seedPromotionRules.id),
    status: varchar('status', { length: 24 }).notNull().default('ACTIVE'),
    pricingMode: varchar('pricing_mode', { length: 32 }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
    reservedSeedQuantity: integer('reserved_seed_quantity').notNull().default(0),
    qualificationSnapshot: jsonb('qualification_snapshot').notNull(),
    pricingSnapshot: jsonb('pricing_snapshot').notNull(),
    requestId: uuid('request_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('checkout_quotes_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    index('checkout_quotes_expiry_idx').on(table.status, table.expiresAt),
    check('checkout_quotes_status_ck', sql`${table.status} in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED')`),
    check('checkout_quotes_mode_ck', sql`${table.pricingMode} in ('STANDARD', 'SEED_PROMOTION')`),
    check(
      'checkout_quotes_amount_ck',
      sql`${table.amountMinor} >= 0 and ${table.currency} = 'CNY' and ${table.reservedSeedQuantity} >= 0`,
    ),
    check('checkout_quotes_expiry_ck', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

// Money flow ownership: order / payment / fulfillment. No entitlement foreign keys are stored here.
export const moneyOrders = pgTable(
  'money_orders',
  {
    id: id(),
    orderNumber: varchar('order_number', { length: 64 }).notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    checkoutQuoteId: uuid('checkout_quote_id')
      .notNull()
      .references(() => checkoutQuotes.id),
    offeringVersionId: uuid('offering_version_id')
      .notNull()
      .references(() => offeringVersions.id),
    status: varchar('status', { length: 24 }).notNull().default('PENDING_PAYMENT'),
    amountMinor: integer('amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
    businessContextType: varchar('business_context_type', { length: 64 }),
    businessContextId: varchar('business_context_id', { length: 128 }),
    requestId: uuid('request_id').notNull(),
    version: integer('version').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('money_orders_number_uq').on(table.orderNumber),
    uniqueIndex('money_orders_quote_uq').on(table.checkoutQuoteId),
    index('money_orders_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    index('money_orders_timeout_idx').on(table.status, table.expiresAt),
    index('money_orders_context_idx').on(table.businessContextType, table.businessContextId),
    check(
      'money_orders_status_ck',
      sql`${table.status} in ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID', 'FULFILLING', 'FULFILLED', 'CLOSED', 'REFUNDING', 'REFUNDED', 'EXCEPTION')`,
    ),
    check('money_orders_amount_ck', sql`${table.amountMinor} >= 0 and ${table.currency} = 'CNY'`),
    check('money_orders_version_ck', sql`${table.version} >= 0`),
    check(
      'money_orders_context_pair_ck',
      sql`(${table.businessContextType} is null) = (${table.businessContextId} is null)`,
    ),
  ],
);

export const orderSnapshots = pgTable(
  'order_snapshots',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => moneyOrders.id),
    offeringSnapshot: jsonb('offering_snapshot').notNull(),
    quoteSnapshot: jsonb('quote_snapshot').notNull(),
    refundPolicySnapshot: jsonb('refund_policy_snapshot').notNull(),
    termsSnapshot: jsonb('terms_snapshot').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('order_snapshots_order_uq').on(table.orderId)],
);

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => moneyOrders.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerAttemptId: varchar('provider_attempt_id', { length: 128 }),
    status: varchar('status', { length: 24 }).notNull().default('CREATED'),
    amountMinor: integer('amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
    clientParameters: jsonb('client_parameters'),
    failure: jsonb('failure'),
    requestId: uuid('request_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('payment_attempts_provider_id_uq')
      .on(table.provider, table.providerAttemptId)
      .where(sql`${table.providerAttemptId} is not null`),
    uniqueIndex('payment_attempts_one_success_per_order_uq')
      .on(table.orderId)
      .where(sql`${table.status} = 'SUCCEEDED'`),
    index('payment_attempts_order_cursor_idx').on(table.orderId, table.createdAt, table.id),
    check(
      'payment_attempts_status_ck',
      sql`${table.status} in ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'CLOSED')`,
    ),
    check('payment_attempts_amount_ck', sql`${table.amountMinor} >= 0 and ${table.currency} = 'CNY'`),
  ],
);

export const paymentEvents = pgTable(
  'payment_events',
  {
    id: id(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 160 }).notNull(),
    paymentAttemptId: uuid('payment_attempt_id').references(() => paymentAttempts.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => moneyOrders.id),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    signatureVerified: boolean('signature_verified').notNull(),
    verificationSnapshot: jsonb('verification_snapshot').notNull(),
    payloadCiphertext: text('payload_ciphertext'),
    providerOccurredAt: timestamp('provider_occurred_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_events_provider_event_uq').on(table.provider, table.providerEventId),
    index('payment_events_order_idx').on(table.orderId, table.receivedAt, table.id),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => moneyOrders.id),
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    businessKey: varchar('business_key', { length: 160 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('REQUESTED'),
    reasonCode: varchar('reason_code', { length: 64 }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
    refundPolicyVersion: varchar('refund_policy_version', { length: 64 }).notNull(),
    eligibilitySnapshot: jsonb('eligibility_snapshot').notNull(),
    providerRefundId: varchar('provider_refund_id', { length: 128 }),
    requestId: uuid('request_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('refunds_business_key_uq').on(table.businessKey),
    uniqueIndex('refunds_provider_id_uq')
      .on(table.providerRefundId)
      .where(sql`${table.providerRefundId} is not null`),
    index('refunds_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    check(
      'refunds_status_ck',
      sql`${table.status} in ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED')`,
    ),
    check('refunds_amount_ck', sql`${table.amountMinor} > 0 and ${table.currency} = 'CNY'`),
  ],
);

export const fulfillmentJobs = pgTable(
  'fulfillment_jobs',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => moneyOrders.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    businessKey: varchar('business_key', { length: 160 }).notNull(),
    fulfillmentType: varchar('fulfillment_type', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('PENDING'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    resultReferences: jsonb('result_references').notNull().default({}),
    lastFailure: jsonb('last_failure'),
    requestId: uuid('request_id').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('fulfillment_jobs_business_key_uq').on(table.businessKey),
    index('fulfillment_jobs_retry_idx').on(table.status, table.nextAttemptAt),
    index('fulfillment_jobs_order_idx').on(table.orderId, table.createdAt),
    check(
      'fulfillment_jobs_status_ck',
      sql`${table.status} in ('PENDING', 'RUNNING', 'SUCCEEDED', 'RETRY_WAIT', 'FAILED', 'COMPENSATING', 'COMPENSATED')`,
    ),
    check(
      'fulfillment_jobs_attempt_ck',
      sql`${table.attempt} >= 0 and ${table.maxAttempts} > 0 and ${table.attempt} <= ${table.maxAttempts}`,
    ),
  ],
);

// Purchased and membership service entitlements: append-only usage ledger.
export const entitlementGrants = pgTable(
  'entitlement_grants',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    serviceType: varchar('service_type', { length: 64 }).notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    sourceId: varchar('source_id', { length: 128 }).notNull(),
    totalQuantity: integer('total_quantity').notNull(),
    availableQuantity: integer('available_quantity').notNull(),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    status: varchar('status', { length: 24 }).notNull().default('ACTIVE'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    expiryTimezone: varchar('expiry_timezone', { length: 64 }).notNull(),
    ruleVersion: varchar('rule_version', { length: 64 }).notNull(),
    requestId: uuid('request_id').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('entitlement_grants_source_uq').on(table.sourceType, table.sourceId, table.serviceType),
    index('entitlement_grants_candidate_idx').on(
      table.ownerUserId,
      table.businessSpace,
      table.serviceType,
      table.status,
      table.expiresAt,
      table.grantedAt,
      table.id,
    ),
    check(
      'entitlement_grants_balance_ck',
      sql`${table.totalQuantity} > 0 and ${table.availableQuantity} >= 0 and ${table.reservedQuantity} >= 0 and ${table.availableQuantity} + ${table.reservedQuantity} <= ${table.totalQuantity}`,
    ),
    check(
      'entitlement_grants_period_ck',
      sql`${table.expiresAt} > ${table.effectiveAt} and ${table.grantedAt} <= ${table.effectiveAt}`,
    ),
    check(
      'entitlement_grants_status_ck',
      sql`${table.status} in ('PENDING', 'ACTIVE', 'FROZEN', 'EXHAUSTED', 'EXPIRED', 'FORFEITED')`,
    ),
    check(
      'entitlement_grants_source_ck',
      sql`${table.sourceType} in ('PURCHASE', 'MEMBERSHIP', 'MANUAL', 'MIGRATION')`,
    ),
  ],
);

export const entitlementUsageEntries = pgTable(
  'entitlement_usage_entries',
  {
    id: id(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => entitlementGrants.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    entryType: varchar('entry_type', { length: 24 }).notNull(),
    quantity: integer('quantity').notNull(),
    availableAfter: integer('available_after').notNull(),
    reservedAfter: integer('reserved_after').notNull(),
    businessKey: varchar('business_key', { length: 160 }).notNull(),
    reservationId: uuid('reservation_id'),
    consumptionIntentId: uuid('consumption_intent_id'),
    businessContextType: varchar('business_context_type', { length: 64 }),
    businessContextId: varchar('business_context_id', { length: 128 }),
    originalEntryId: uuid('original_entry_id').references((): AnyPgColumn => entitlementUsageEntries.id),
    operatorAdjustmentId: uuid('operator_adjustment_id'),
    requestId: uuid('request_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('entitlement_usage_entries_business_uq').on(
      table.grantId,
      table.entryType,
      table.businessKey,
    ),
    index('entitlement_usage_entries_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    index('entitlement_usage_entries_intent_idx').on(table.consumptionIntentId, table.createdAt),
    check(
      'entitlement_usage_entries_type_ck',
      sql`${table.entryType} in ('GRANT', 'RESERVE', 'COMMIT', 'RELEASE', 'REVERSE', 'EXPIRE', 'FREEZE', 'UNFREEZE', 'FORFEIT', 'ADJUSTMENT')`,
    ),
    check('entitlement_usage_entries_quantity_ck', sql`${table.quantity} > 0`),
    check(
      'entitlement_usage_entries_balance_ck',
      sql`${table.availableAfter} >= 0 and ${table.reservedAfter} >= 0`,
    ),
    check(
      'entitlement_usage_entries_context_pair_ck',
      sql`(${table.businessContextType} is null) = (${table.businessContextId} is null)`,
    ),
  ],
);

// Complimentary seed batches remain separate from money and service-entitlement ledgers.
export const complimentarySeedGrants = pgTable(
  'complimentary_seed_grants',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    sourceId: varchar('source_id', { length: 128 }).notNull(),
    applicableServices: jsonb('applicable_services').notNull(),
    totalQuantity: integer('total_quantity').notNull(),
    availableQuantity: integer('available_quantity').notNull(),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    status: varchar('status', { length: 24 }).notNull().default('ACTIVE'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    expiryTimezone: varchar('expiry_timezone', { length: 64 }),
    ruleVersion: varchar('rule_version', { length: 64 }).notNull(),
    migrationVersion: varchar('migration_version', { length: 64 }),
    requestId: uuid('request_id').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('complimentary_seed_grants_source_uq').on(
      table.ownerUserId,
      table.sourceType,
      table.sourceId,
    ),
    index('complimentary_seed_grants_candidate_idx').on(
      table.ownerUserId,
      table.businessSpace,
      table.status,
      table.expiresAt,
      table.grantedAt,
      table.id,
    ),
    check(
      'complimentary_seed_grants_balance_ck',
      sql`${table.totalQuantity} > 0 and ${table.availableQuantity} >= 0 and ${table.reservedQuantity} >= 0 and ${table.availableQuantity} + ${table.reservedQuantity} <= ${table.totalQuantity}`,
    ),
    check(
      'complimentary_seed_grants_period_ck',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveAt}`,
    ),
    check(
      'complimentary_seed_grants_status_ck',
      sql`${table.status} in ('PENDING', 'ACTIVE', 'FROZEN', 'EXHAUSTED', 'EXPIRED')`,
    ),
    check(
      'complimentary_seed_grants_source_ck',
      sql`${table.sourceType} in ('REGISTRATION', 'ACTIVITY', 'MANUAL', 'RESTORE', 'MIGRATION')`,
    ),
  ],
);

export const complimentarySeedAllocations = pgTable(
  'complimentary_seed_allocations',
  {
    id: id(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => complimentarySeedGrants.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    reservationId: uuid('reservation_id').notNull(),
    consumptionIntentId: uuid('consumption_intent_id'),
    quantity: integer('quantity').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('RESERVED'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('complimentary_seed_allocations_reservation_grant_uq').on(table.reservationId, table.grantId),
    index('complimentary_seed_allocations_intent_idx').on(table.consumptionIntentId, table.createdAt),
    check('complimentary_seed_allocations_quantity_ck', sql`${table.quantity} > 0`),
    check(
      'complimentary_seed_allocations_status_ck',
      sql`${table.status} in ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED')`,
    ),
  ],
);

export const complimentarySeedEntries = pgTable(
  'complimentary_seed_entries',
  {
    id: id(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => complimentarySeedGrants.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    entryType: varchar('entry_type', { length: 24 }).notNull(),
    quantity: integer('quantity').notNull(),
    availableAfter: integer('available_after').notNull(),
    reservedAfter: integer('reserved_after').notNull(),
    businessKey: varchar('business_key', { length: 160 }).notNull(),
    reservationId: uuid('reservation_id'),
    consumptionIntentId: uuid('consumption_intent_id'),
    businessContextType: varchar('business_context_type', { length: 64 }),
    businessContextId: varchar('business_context_id', { length: 128 }),
    originalEntryId: uuid('original_entry_id').references((): AnyPgColumn => complimentarySeedEntries.id),
    operatorAdjustmentId: uuid('operator_adjustment_id'),
    requestId: uuid('request_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('complimentary_seed_entries_business_uq').on(
      table.grantId,
      table.entryType,
      table.businessKey,
    ),
    index('complimentary_seed_entries_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    index('complimentary_seed_entries_intent_idx').on(table.consumptionIntentId, table.createdAt),
    check(
      'complimentary_seed_entries_type_ck',
      sql`${table.entryType} in ('GRANT', 'RESERVE', 'CONSUME', 'RELEASE', 'RESTORE', 'EXPIRE', 'ADJUSTMENT')`,
    ),
    check('complimentary_seed_entries_quantity_ck', sql`${table.quantity} > 0`),
    check(
      'complimentary_seed_entries_balance_ck',
      sql`${table.availableAfter} >= 0 and ${table.reservedAfter} >= 0`,
    ),
    check(
      'complimentary_seed_entries_context_pair_ck',
      sql`(${table.businessContextType} is null) = (${table.businessContextId} is null)`,
    ),
  ],
);

export const complimentarySeedAccountProjections = pgTable(
  'complimentary_seed_account_projections',
  {
    ownerUserId: uuid('owner_user_id')
      .primaryKey()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    availableQuantity: integer('available_quantity').notNull().default(0),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    totalGranted: bigint('total_granted', { mode: 'number' }).notNull().default(0),
    totalConsumed: bigint('total_consumed', { mode: 'number' }).notNull().default(0),
    version: integer('version').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'complimentary_seed_account_projections_balance_ck',
      sql`${table.availableQuantity} >= 0 and ${table.reservedQuantity} >= 0`,
    ),
  ],
);

// Resolution records are audit facts; consumption intents own reservation lifecycle orchestration.
export const entitlementResolutions = pgTable(
  'entitlement_resolutions',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    serviceType: varchar('service_type', { length: 64 }).notNull(),
    quantity: integer('quantity').notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    businessContextType: varchar('business_context_type', { length: 64 }).notNull(),
    businessContextId: varchar('business_context_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    selectedSourceType: varchar('selected_source_type', { length: 32 }),
    selectedSourceId: varchar('selected_source_id', { length: 128 }),
    reasonCode: varchar('reason_code', { length: 64 }).notNull(),
    selectionMode: varchar('selection_mode', { length: 32 }).notNull().default('SYSTEM_RULE'),
    ruleVersion: varchar('rule_version', { length: 64 }).notNull(),
    requirementSnapshot: jsonb('requirement_snapshot').notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('entitlement_resolutions_context_idx').on(
      table.businessContextType,
      table.businessContextId,
      table.createdAt,
    ),
    index('entitlement_resolutions_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    check('entitlement_resolutions_quantity_ck', sql`${table.quantity} > 0`),
    check('entitlement_resolutions_status_ck', sql`${table.status} in ('RESOLVED', 'NO_BENEFIT', 'INVALID')`),
    check('entitlement_resolutions_selection_ck', sql`${table.selectionMode} = 'SYSTEM_RULE'`),
    check(
      'entitlement_resolutions_source_pair_ck',
      sql`(${table.selectedSourceType} is null) = (${table.selectedSourceId} is null)`,
    ),
  ],
);

export const resolutionCandidates = pgTable(
  'resolution_candidates',
  {
    id: id(),
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => entitlementResolutions.id),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    sourceId: varchar('source_id', { length: 128 }).notNull(),
    priority: integer('priority').notNull(),
    availableQuantity: integer('available_quantity').notNull(),
    requiredQuantity: integer('required_quantity').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    costSnapshot: jsonb('cost_snapshot').notNull(),
    ruleSnapshot: jsonb('rule_snapshot').notNull(),
    selected: boolean('selected').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('resolution_candidates_source_uq').on(table.resolutionId, table.sourceType, table.sourceId),
    uniqueIndex('resolution_candidates_priority_uq').on(table.resolutionId, table.priority),
    uniqueIndex('resolution_candidates_one_selected_uq')
      .on(table.resolutionId)
      .where(sql`${table.selected} = true`),
    check(
      'resolution_candidates_quantity_ck',
      sql`${table.priority} > 0 and ${table.availableQuantity} >= 0 and ${table.requiredQuantity} > 0`,
    ),
  ],
);

export const consumptionIntents = pgTable(
  'consumption_intents',
  {
    id: id(),
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => entitlementResolutions.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    serviceType: varchar('service_type', { length: 64 }).notNull(),
    businessContextType: varchar('business_context_type', { length: 64 }).notNull(),
    businessContextId: varchar('business_context_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('RESERVING'),
    selectedSourceType: varchar('selected_source_type', { length: 32 }).notNull(),
    selectedSourceId: varchar('selected_source_id', { length: 128 }).notNull(),
    requiredQuantity: integer('required_quantity').notNull(),
    reservationDeadline: timestamp('reservation_deadline', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    requestId: uuid('request_id').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('consumption_intents_resolution_uq').on(table.resolutionId),
    uniqueIndex('consumption_intents_context_uq').on(
      table.businessSpace,
      table.businessContextType,
      table.businessContextId,
    ),
    index('consumption_intents_timeout_idx').on(table.status, table.reservationDeadline),
    index('consumption_intents_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    check(
      'consumption_intents_status_ck',
      sql`${table.status} in ('RESERVING', 'RESERVED', 'RUNNING', 'COMMITTED', 'RELEASED', 'EXPIRED', 'FAILED')`,
    ),
    check('consumption_intents_quantity_ck', sql`${table.requiredQuantity} > 0`),
  ],
);

export const reservationAllocations = pgTable(
  'reservation_allocations',
  {
    id: id(),
    consumptionIntentId: uuid('consumption_intent_id')
      .notNull()
      .references(() => consumptionIntents.id),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    sourceId: varchar('source_id', { length: 128 }).notNull(),
    sourceReservationId: uuid('source_reservation_id').notNull(),
    quantity: integer('quantity').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('RESERVED'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('reservation_allocations_source_reservation_uq').on(
      table.sourceType,
      table.sourceReservationId,
    ),
    index('reservation_allocations_intent_idx').on(table.consumptionIntentId, table.createdAt, table.id),
    check('reservation_allocations_quantity_ck', sql`${table.quantity} > 0`),
    check('reservation_allocations_status_ck', sql`${table.status} in ('RESERVED', 'COMMITTED', 'RELEASED')`),
  ],
);

// Membership identity is separate from period entitlements.
export const membershipSubscriptions = pgTable(
  'membership_subscriptions',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('ACTIVE'),
    currentPlanVersionId: uuid('current_plan_version_id')
      .notNull()
      .references(() => offeringVersions.id),
    sourceOrderId: uuid('source_order_id')
      .notNull()
      .references(() => moneyOrders.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    terminationReason: varchar('termination_reason', { length: 64 }),
    requestId: uuid('request_id').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('membership_subscriptions_source_order_uq').on(table.sourceOrderId),
    uniqueIndex('membership_subscriptions_one_active_uq')
      .on(table.ownerUserId, table.businessSpace)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('membership_subscriptions_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    check(
      'membership_subscriptions_status_ck',
      sql`${table.status} in ('ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED')`,
    ),
    check('membership_subscriptions_period_ck', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const membershipPeriods = pgTable(
  'membership_periods',
  {
    id: id(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => membershipSubscriptions.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    sequence: integer('sequence').notNull(),
    planVersionId: uuid('plan_version_id')
      .notNull()
      .references(() => offeringVersions.id),
    sourceOrderId: uuid('source_order_id')
      .notNull()
      .references(() => moneyOrders.id),
    status: varchar('status', { length: 24 }).notNull().default('QUEUED'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    benefitsGrantedAt: timestamp('benefits_granted_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    requestId: uuid('request_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('membership_periods_subscription_sequence_uq').on(table.subscriptionId, table.sequence),
    uniqueIndex('membership_periods_source_order_uq').on(table.sourceOrderId),
    uniqueIndex('membership_periods_one_active_uq')
      .on(table.ownerUserId, table.businessSpace)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('membership_periods_activation_idx').on(table.status, table.startsAt),
    index('membership_periods_subscription_queue_idx').on(table.subscriptionId, table.startsAt, table.id),
    check('membership_periods_sequence_ck', sql`${table.sequence} > 0`),
    check(
      'membership_periods_status_ck',
      sql`${table.status} in ('QUEUED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED')`,
    ),
    check('membership_periods_range_ck', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const membershipUpgrades = pgTable(
  'membership_upgrades',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    previousSubscriptionId: uuid('previous_subscription_id')
      .notNull()
      .references(() => membershipSubscriptions.id),
    newOrderId: uuid('new_order_id')
      .notNull()
      .references(() => moneyOrders.id),
    newSubscriptionId: uuid('new_subscription_id').references(() => membershipSubscriptions.id),
    status: varchar('status', { length: 24 }).notNull().default('QUOTED'),
    requestId: uuid('request_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failure: jsonb('failure'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('membership_upgrades_new_order_uq').on(table.newOrderId),
    uniqueIndex('membership_upgrades_new_subscription_uq')
      .on(table.newSubscriptionId)
      .where(sql`${table.newSubscriptionId} is not null`),
    index('membership_upgrades_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    check(
      'membership_upgrades_status_ck',
      sql`${table.status} in ('QUOTED', 'ORDER_CREATED', 'PAID', 'ACTIVATING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
  ],
);

export const upgradeAssessments = pgTable(
  'upgrade_assessments',
  {
    id: id(),
    upgradeId: uuid('upgrade_id')
      .notNull()
      .references(() => membershipUpgrades.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    previousSubscriptionId: uuid('previous_subscription_id')
      .notNull()
      .references(() => membershipSubscriptions.id),
    remainingTimeBasisPoints: integer('remaining_time_basis_points').notNull(),
    remainingQuotaBasisPoints: integer('remaining_quota_basis_points').notNull(),
    residualValueEstimateMinor: integer('residual_value_estimate_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
    assessmentRuleVersion: varchar('assessment_rule_version', { length: 64 }).notNull(),
    internalOnly: boolean('internal_only').notNull().default(true),
    inputSnapshot: jsonb('input_snapshot').notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('upgrade_assessments_upgrade_uq').on(table.upgradeId),
    index('upgrade_assessments_subscription_idx').on(table.previousSubscriptionId, table.createdAt),
    check(
      'upgrade_assessments_ratios_ck',
      sql`${table.remainingTimeBasisPoints} between 0 and 10000 and ${table.remainingQuotaBasisPoints} between 0 and 10000`,
    ),
    check(
      'upgrade_assessments_value_ck',
      sql`${table.residualValueEstimateMinor} >= 0 and ${table.currency} = 'CNY'`,
    ),
    check('upgrade_assessments_internal_only_ck', sql`${table.internalOnly} = true`),
  ],
);

export const reconciliationCases = pgTable(
  'reconciliation_cases',
  {
    id: id(),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    caseType: varchar('case_type', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('OPEN'),
    severity: varchar('severity', { length: 16 }).notNull(),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    resourceId: varchar('resource_id', { length: 128 }).notNull(),
    businessKey: varchar('business_key', { length: 160 }).notNull(),
    expectedSnapshot: jsonb('expected_snapshot').notNull(),
    actualSnapshot: jsonb('actual_snapshot').notNull(),
    resolution: jsonb('resolution'),
    requestId: uuid('request_id'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('reconciliation_cases_business_key_uq').on(table.caseType, table.businessKey),
    index('reconciliation_cases_open_idx').on(table.status, table.severity, table.detectedAt),
    check(
      'reconciliation_cases_status_ck',
      sql`${table.status} in ('OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED')`,
    ),
    check('reconciliation_cases_severity_ck', sql`${table.severity} in ('INFO', 'WARNING', 'CRITICAL')`),
  ],
);

export const operatorAdjustments = pgTable(
  'operator_adjustments',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    businessSpace: varchar('business_space', { length: 32 }).notNull(),
    ledgerType: varchar('ledger_type', { length: 32 }).notNull(),
    grantId: uuid('grant_id').notNull(),
    quantity: integer('quantity').notNull(),
    direction: varchar('direction', { length: 16 }).notNull(),
    reasonCode: varchar('reason_code', { length: 64 }).notNull(),
    note: text('note').notNull(),
    operatorUserId: uuid('operator_user_id')
      .notNull()
      .references(() => users.id),
    relatedOrderId: uuid('related_order_id').references(() => moneyOrders.id),
    relatedTaskId: uuid('related_task_id'),
    requestId: uuid('request_id').notNull(),
    ledgerEntryId: uuid('ledger_entry_id'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('operator_adjustments_request_uq').on(table.requestId),
    index('operator_adjustments_owner_cursor_idx').on(table.ownerUserId, table.createdAt, table.id),
    index('operator_adjustments_operator_idx').on(table.operatorUserId, table.createdAt),
    check(
      'operator_adjustments_ledger_ck',
      sql`${table.ledgerType} in ('ENTITLEMENT', 'COMPLIMENTARY_SEED')`,
    ),
    check('operator_adjustments_direction_ck', sql`${table.direction} in ('INCREASE', 'DECREASE')`),
    check('operator_adjustments_quantity_ck', sql`${table.quantity} > 0`),
  ],
);

export const inboxConsumptions = pgTable(
  'inbox_consumptions',
  {
    id: id(),
    eventId: uuid('event_id').notNull(),
    consumer: varchar('consumer', { length: 64 }).notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    envelopeVersion: integer('envelope_version').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('PROCESSING'),
    attempt: integer('attempt').notNull().default(1),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    failure: jsonb('failure'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('inbox_consumptions_event_consumer_uq').on(table.eventId, table.consumer),
    index('inbox_consumptions_retry_idx').on(table.status, table.nextAttemptAt),
    check('inbox_consumptions_version_ck', sql`${table.envelopeVersion} > 0`),
    check('inbox_consumptions_attempt_ck', sql`${table.attempt} > 0`),
    check(
      'inbox_consumptions_status_ck',
      sql`${table.status} in ('PROCESSING', 'RETRY_WAIT', 'COMPLETED', 'DEAD_LETTER')`,
    ),
  ],
);
