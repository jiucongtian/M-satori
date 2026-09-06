import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldCipher } from '../../packages/infrastructure/src/security/field-cipher.js';
import { buildPlan } from '../../packages/modules/src/legacy-miniapp-import/plan.js';
import { executePlan } from '../../packages/modules/src/legacy-miniapp-import/importer.js';
import {
  syntheticMapping,
  syntheticSource,
} from '../../packages/modules/src/legacy-miniapp-import/fixtures.js';
import { digest } from '../../packages/modules/src/legacy-miniapp-import/source.js';
import { assessSource, object } from '../../packages/modules/src/legacy-miniapp-import/source.js';
import { loadArchive } from '../../packages/modules/src/legacy-miniapp-import/archive.js';
import type { Mapping } from '../../packages/modules/src/legacy-miniapp-import/plan.js';

const connectionString = process.env.MINIAPP_TEST_DATABASE_URL;
const key = '11'.repeat(32);
const options = { encryptionKey: key, cursorSecret: 'synthetic-test-cursor-secret', commit: true };

describe.skipIf(!connectionString)('miniapp import in an isolated PostgreSQL database', () => {
  let pool: Pool;
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/satori_miniapp_import_test'
    ) {
      throw new Error('Tests require a dedicated local satori_miniapp_import_test database');
    }
    pool = new Pool({ connectionString, max: 4 });
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    if ((await pool.query("select id from card_decks where status='ACTIVE'")).rowCount) return;
    const deckId = randomUUID();
    await pool.query(
      "insert into card_decks (id, code, version, name, asset_base_url, status) values ($1, $2, '1.0.0', 'Synthetic deck', '/cards/test', 'ACTIVE')",
      [deckId, 'synthetic-deck'],
    );
    const manifest = JSON.parse(await readFile('./assets/card-manifest.json', 'utf8')) as Array<
      Record<string, string | number>
    >;
    for (const card of manifest)
      await pool.query(
        `insert into card_catalog
      (id, deck_id, card_number, card_code, ganzhi, zodiac, season, talent_mark, ability_mark, journey_mark, asset_path, alt_text)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          deckId,
          card.cardId,
          card.cardCode,
          card.ganzhi,
          card.zodiac,
          card.season,
          card.talentMark,
          card.abilityMark,
          card.journeyMark,
          card.asset,
          'Synthetic card',
        ],
      );
  }, 30000);
  afterAll(async () => {
    if (pool) await pool.end();
  });

  async function fixture() {
    const userId = randomUUID();
    await pool.query('insert into users (id) values ($1)', [userId]);
    const source = await syntheticSource();
    source.namespace = `test-${randomUUID()}`;
    const mapping = syntheticMapping(userId);
    mapping.namespace = source.namespace;
    return { userId, source, mapping };
  }
  async function run(plan: Awaited<ReturnType<typeof buildPlan>>, commit = true) {
    const client = await pool.connect();
    try {
      return await executePlan(client, plan, { ...options, commit });
    } finally {
      client.release();
    }
  }
  async function counts() {
    const tables = [
      'users',
      'identities',
      'subjects',
      'life_profiles',
      'life_profile_revisions',
      'location_snapshots',
      'astrology_snapshots',
      'card_bindings',
      'audit_logs',
      'idempotency_records',
      'generation_tasks',
      'outbox',
      'seed_accounts',
      'seed_entries',
      'money_orders',
    ];
    const result: Record<string, number> = {};
    for (const table of tables)
      result[table] = Number(
        (await pool.query<{ count: string }>(`select count(*) from ${table}`)).rows[0]!.count,
      );
    return result;
  }
  async function structure() {
    return digest(
      (
        await pool.query(`select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns where table_schema='public' order by table_name, ordinal_position`)
      ).rows,
    );
  }

  it('creates encrypted native profiles and all four card bindings without DDL, payments, AI or account creation', async () => {
    const { source, mapping, userId } = await fixture();
    const before = await counts();
    const schemaBefore = await structure();
    const result = await run(await buildPlan(source, mapping));
    expect(result.committed).toBe(true);
    const profileId = result.results[0]!.profileId;
    const { rows } = await pool.query<{
      display_name_ciphertext: string;
      created_at: Date;
      birth_data_ciphertext: string;
      status: string;
    }>(
      `select s.display_name_ciphertext, lp.created_at, r.birth_data_ciphertext, r.status
      from life_profiles lp join subjects s on s.id=lp.subject_id join life_profile_revisions r on r.id=lp.active_revision_id
      where lp.id=$1 and lp.owner_user_id=$2`,
      [profileId, userId],
    );
    const cipher = new FieldCipher(key);
    expect(cipher.decrypt(rows[0]!.display_name_ciphertext)).toBe('测试档案');
    expect(JSON.parse(cipher.decrypt(rows[0]!.birth_data_ciphertext))).toMatchObject({
      date: { year: 1990, month: 6, day: 15 },
      calculationGender: 'MALE',
    });
    expect(rows[0]!.created_at.toISOString()).toBe('2024-01-02T03:04:05.000Z');
    expect(rows[0]!.status).toBe('ACTIVE');
    const after = await counts();
    expect(after.card_bindings! - before.card_bindings!).toBe(4);
    for (const table of [
      'users',
      'identities',
      'generation_tasks',
      'outbox',
      'seed_accounts',
      'seed_entries',
      'money_orders',
    ])
      expect(after[table]).toBe(before[table]);
    expect(await structure()).toBe(schemaBefore);
  });

  it('executes the full dry run including nested service transactions and leaves no rows behind', async () => {
    const { source, mapping } = await fixture();
    const before = await counts();
    const result = await run(await buildPlan(source, mapping), false);
    expect(result.committed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(await counts()).toEqual(before);
  });

  it('replays without duplication even when ordinary idempotency records have expired', async () => {
    const { source, mapping } = await fixture();
    const plan = await buildPlan(source, mapping);
    const first = await run(plan);
    await pool.query('delete from idempotency_records where actor_key=$1', [
      `user:${mapping.users[0]!.targetUserId}`,
    ]);
    const before = await counts();
    const second = await run(plan);
    expect(second.results[0]).toEqual({ ...first.results[0], state: 'REPLAYED' });
    expect(await counts()).toEqual(before);
  });

  it('rolls back earlier records when a later SELF import would overwrite an existing profile', async () => {
    const { source, mapping, userId } = await fixture();
    const selfSubject = randomUUID();
    await pool.query(
      "insert into subjects (id, owner_user_id, type, display_name_ciphertext) values ($1,$2,'SELF',$3)",
      [selfSubject, userId, new FieldCipher(key).encrypt('已存在的本人')],
    );
    source.profiles.push({ ...source.profiles[0], _id: 'second-profile' });
    mapping.profiles.push({
      ...mapping.profiles[0]!,
      sourceProfileId: 'second-profile',
      subjectType: 'SELF',
    });
    const before = await counts();
    await expect(run(await buildPlan(source, mapping))).rejects.toThrow(
      'EXISTING_SELF_PROFILE_WOULD_BE_OVERWRITTEN',
    );
    expect(await counts()).toEqual(before);
    expect(
      new FieldCipher(key).decrypt(
        (
          await pool.query<{ display_name_ciphertext: string }>(
            'select display_name_ciphertext from subjects where id=$1',
            [selfSubject],
          )
        ).rows[0]!.display_name_ciphertext,
      ),
    ).toBe('已存在的本人');
  });

  it('imports a confirmed SELF name correctly when there is no existing SELF', async () => {
    const { source, mapping, userId } = await fixture();
    mapping.profiles[0]!.subjectType = 'SELF';
    await run(await buildPlan(source, mapping));
    const row = (
      await pool.query<{ display_name_ciphertext: string }>(
        "select display_name_ciphertext from subjects where owner_user_id=$1 and type='SELF'",
        [userId],
      )
    ).rows[0];
    expect(new FieldCipher(key).decrypt(row!.display_name_ciphertext)).toBe('测试档案');
  });

  it('rejects changed input on replay and prevents a source account being claimed by another target', async () => {
    const { source, mapping } = await fixture();
    await run(await buildPlan(source, mapping));
    const before = await counts();
    mapping.profiles[0]!.relationshipType = 'FRIEND';
    await expect(run(await buildPlan(source, mapping))).rejects.toThrow('IMPORT_REPLAY_CONFLICT');
    expect(await counts()).toEqual(before);
    const other = randomUUID();
    await pool.query('insert into users (id) values ($1)', [other]);
    mapping.users[0]!.targetUserId = other;
    await expect(run(await buildPlan(source, mapping))).rejects.toThrow('SOURCE_USER_ALREADY_CLAIMED');
  });

  it('does not recreate an imported profile deleted by its owner', async () => {
    const { source, mapping } = await fixture();
    const plan = await buildPlan(source, mapping);
    const result = await run(plan);
    await pool.query('update life_profiles set deleted_at=now() where id=$1', [result.results[0]!.profileId]);
    const before = await counts();
    await expect(run(plan)).rejects.toThrow('PREVIOUS_IMPORT_REMOVED');
    expect(await counts()).toEqual(before);
  });

  it('serializes concurrent batches using durable audit markers', async () => {
    const { source, mapping } = await fixture();
    const plan = await buildPlan(source, mapping);
    const outcomes = await Promise.all([run(plan), run(plan)]);
    expect(outcomes.flatMap((outcome) => outcome.results.map((row) => row.state)).sort()).toEqual([
      'IMPORTED',
      'REPLAYED',
    ]);
    expect(outcomes[0].results[0]!.profileId).toBe(outcomes[1].results[0]!.profileId);
  });

  it('rejects the wrong target encryption key before creating any profile', async () => {
    const { source, mapping } = await fixture();
    const plan = await buildPlan(source, mapping);
    const before = await counts();
    const client = await pool.connect();
    try {
      await expect(executePlan(client, plan, { ...options, encryptionKey: '22'.repeat(32) })).rejects.toThrow(
        'TARGET_ENCRYPTION_KEY_MISMATCH',
      );
    } finally {
      client.release();
    }
    expect(await counts()).toEqual(before);
  });

  it.skipIf(!process.env.MINIAPP_REAL_ARCHIVE_PATH || !process.env.MINIAPP_REAL_KEY_PATH)(
    'roundtrips a diverse actual-export sample using only synthetic target accounts and test locations',
    async () => {
      const source = await loadArchive(
        process.env.MINIAPP_REAL_ARCHIVE_PATH!,
        process.env.MINIAPP_REAL_KEY_PATH!,
      );
      const assessment = assessSource(source);
      const eligibleIds = new Set(
        assessment.profiles
          .filter((item) => item.disposition === 'ELIGIBLE')
          .map((item) => item.sourceProfileId),
      );
      const eligible = source.profiles.filter((profile) => eligibleIds.has(String(profile._id)));
      const ownerCounts = new Map<string, number>();
      for (const profile of eligible)
        ownerCounts.set(String(profile.userId), (ownerCounts.get(String(profile.userId)) ?? 0) + 1);
      const largestOwner = [...ownerCounts].sort((a, b) => b[1] - a[1])[0]![0];
      const samples = new Map(
        eligible
          .filter((profile) => profile.userId === largestOwner)
          .map((profile) => [profile._id, profile]),
      );
      for (const match of [
        eligible.find((profile) => object(profile.birthDate).isLeapMonth === true),
        eligible.find((profile) => profile.isUncertainTime === true),
        eligible.find((profile) => profile.gender === 0 && object(profile.birthDate).isLunar === true),
        eligible.find((profile) => profile.isUncertainTime === undefined),
      ])
        if (match) samples.set(match._id, match);
      source.profiles = [...samples.values()];
      source.namespace = `test-real-${randomUUID()}`;
      const mapping: Mapping = { version: 1, namespace: source.namespace, users: [], profiles: [] };
      for (const sourceUserId of new Set(source.profiles.map((profile) => String(profile.userId)))) {
        const targetUserId = randomUUID();
        await pool.query('insert into users (id) values ($1)', [targetUserId]);
        mapping.users.push({
          sourceUserId,
          targetUserId,
          verification: { method: 'MANUAL_REVIEW', reference: 'SYNTHETIC-TEST-ONLY-NOT-A-REAL-CLAIM' },
        });
      }
      mapping.profiles = source.profiles.map((profile) => ({
        sourceProfileId: String(profile._id),
        subjectType: 'OTHER',
        relationshipType: 'OTHER',
        locationId: 'loc_cn_110000',
        timePrecision: profile.isUncertainTime === true ? 'DATE_ONLY' : 'APPROXIMATE',
        confirmed: true,
        acceptRecalculatedCards: true,
      }));
      const plan = await buildPlan(source, mapping);
      const before = await counts();
      const schemaBefore = await structure();
      await run(plan, false);
      expect(await counts()).toEqual(before);
      const outcome = await run(plan);
      expect(outcome.results.length).toBe(source.profiles.length);
      for (const result of outcome.results) {
        const row = (
          await pool.query<{ birth_data_ciphertext: string }>(
            'select birth_data_ciphertext from life_profile_revisions where id=$1',
            [result.revisionId],
          )
        ).rows[0]!;
        const expected = plan.profiles.find((profile) => profile.sourceProfileId === result.sourceProfileId)!;
        expect(digest(JSON.parse(new FieldCipher(key).decrypt(row.birth_data_ciphertext)))).toBe(
          digest(expected.birthInput),
        );
      }
      const after = await counts();
      expect(after.card_bindings! - before.card_bindings!).toBe(source.profiles.length * 4);
      await run(plan);
      expect(await counts()).toEqual(after);
      expect(await structure()).toBe(schemaBefore);
      console.info('miniapp_actual_export_database_sample', {
        profiles: source.profiles.length,
        cardBindings: source.profiles.length * 4,
        dryRunRolledBack: true,
        replayPassed: true,
      });
    },
    120000,
  );
});
