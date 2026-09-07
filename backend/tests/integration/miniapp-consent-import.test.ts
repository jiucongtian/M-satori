import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { R1_RUNTIME_POLICY } from '../../packages/infrastructure/src/config/runtime-policy.js';
import * as schema from '../../packages/infrastructure/src/database/schema.js';
import type { RuntimeInfrastructure } from '../../packages/infrastructure/src/runtime.module.js';
import { FieldCipher } from '../../packages/infrastructure/src/security/field-cipher.js';
import { AuthCrypto } from '../../packages/modules/src/identity/auth/auth.crypto.js';
import { loadArchive } from '../../packages/modules/src/legacy-miniapp-import/archive.js';
import {
  syntheticMapping,
  syntheticSource,
} from '../../packages/modules/src/legacy-miniapp-import/fixtures.js';
import { executePlan } from '../../packages/modules/src/legacy-miniapp-import/importer.js';
import { buildPlan } from '../../packages/modules/src/legacy-miniapp-import/plan.js';
import { MiniappImportService } from '../../packages/modules/src/legacy-miniapp-import/miniapp-import.service.js';
import {
  MiniappImportSource,
  normalizeMiniappPhone,
} from '../../packages/modules/src/legacy-miniapp-import/miniapp-import.source.js';
import {
  assessSource,
  digest,
  object,
  type SourceData,
} from '../../packages/modules/src/legacy-miniapp-import/source.js';

const connectionString = process.env.MINIAPP_TEST_DATABASE_URL;
const encryptionKey = '11'.repeat(32);
const archiveKey = '22'.repeat(32);

describe.skipIf(!connectionString)('one-time miniapp consent in an isolated PostgreSQL database', () => {
  let pool: Pool;
  let directory: string;
  let phoneSequence = 0;
  const phonePrefix = `138${String(Date.now()).slice(-4)}`;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/satori_miniapp_import_test'
    ) {
      throw new Error('Tests require a dedicated local satori_miniapp_import_test database');
    }
    pool = new Pool({ connectionString, max: 6 });
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    directory = await mkdtemp(join(tmpdir(), 'satori-miniapp-consent-test-'));
    if ((await pool.query("select id from card_decks where status='ACTIVE'")).rowCount) return;
    const deckId = randomUUID();
    await pool.query(
      "insert into card_decks (id,code,version,name,asset_base_url,status) values ($1,'synthetic-deck','1.0.0','Synthetic deck','/cards/test','ACTIVE')",
      [deckId],
    );
    const manifest = JSON.parse(await readFile('./assets/card-manifest.json', 'utf8')) as Array<
      Record<string, string | number>
    >;
    for (const card of manifest) {
      await pool.query(
        `insert into card_catalog
          (id,deck_id,card_number,card_code,ganzhi,zodiac,season,talent_mark,ability_mark,journey_mark,asset_path,alt_text)
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
    }
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (pool) await pool.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function application(data?: SourceData, authSecret = 'synthetic-consent-auth-secret') {
    const archivePath = join(directory, `${randomUUID()}.encrypted.json`);
    const keyPath = join(directory, `${randomUUID()}.key`);
    if (data) {
      await writeFile(
        archivePath,
        JSON.stringify({
          version: 1,
          sourceHash: digest(data),
          ciphertext: new FieldCipher(archiveKey).encrypt(JSON.stringify(data)),
        }),
        { mode: 0o600 },
      );
      await writeFile(keyPath, archiveKey, { mode: 0o600 });
    }
    const infrastructure = {
      pool,
      database: drizzle(pool, { schema }),
      policy: R1_RUNTIME_POLICY,
      environment: {
        AUTH_HMAC_SECRET: authSecret,
        DATA_ENCRYPTION_KEY: encryptionKey,
        CURSOR_SIGNING_SECRET: 'synthetic-consent-cursor-secret',
        ...(data ? { MINIAPP_IMPORT_ARCHIVE_PATH: archivePath, MINIAPP_IMPORT_KEY_PATH: keyPath } : {}),
      },
    } as unknown as RuntimeInfrastructure;
    const cipher = new FieldCipher(encryptionKey);
    const crypto = new AuthCrypto(infrastructure, cipher);
    const source = new MiniappImportSource(infrastructure, crypto);
    await source.onModuleInit();
    return {
      service: new MiniappImportService(infrastructure, cipher, crypto, source),
      cipher,
      crypto,
    };
  }

  async function fixture(change?: (data: SourceData, phone: string) => void) {
    const phone = `${phonePrefix}${String(++phoneSequence).padStart(4, '0')}`;
    const data = await syntheticSource();
    data.namespace = `consent-${randomUUID()}`;
    data.users[0]!.phoneNumber = phone;
    change?.(data, phone);
    const app = await application(data);
    const userId = randomUUID();
    await pool.query('insert into users (id) values ($1)', [userId]);
    await pool.query(
      `insert into identities (id,user_id,provider,provider_subject_hash,phone_ciphertext,phone_masked)
       values ($1,$2,'PHONE',$3,$4,'138****0000')`,
      [randomUUID(), userId, app.crypto.hash(`phone:+86${phone}`), app.cipher.encrypt(`+86${phone}`)],
    );
    return { ...app, data, userId, phone };
  }

  async function offer(service: MiniappImportService, userId: string) {
    const result = await service.status(userId);
    expect(result.status).toBe('OFFERED');
    if (result.status !== 'OFFERED') throw new Error('Expected an import offer');
    expect(typeof result.offerId).toBe('string');
    return result;
  }

  function decide(
    service: MiniappImportService,
    userId: string,
    offerId: string,
    decision: 'ACCEPT' | 'DECLINE',
    idempotencyKey = randomUUID(),
  ) {
    return service.decide(userId, { offerId, decision, idempotencyKey });
  }

  async function ownerRows(userId: string) {
    const result: Record<string, unknown> = {};
    for (const [table, ownerColumn] of [
      ['subjects', 'owner_user_id'],
      ['life_profiles', 'owner_user_id'],
      ['audit_logs', 'actor_user_id'],
    ]) {
      result[table!] = (
        await pool.query(`select * from ${table} where ${ownerColumn}=$1 order by id`, [userId])
      ).rows;
    }
    return result;
  }

  async function structure() {
    return digest(
      (
        await pool.query(`select table_name,column_name,data_type,is_nullable,column_default
          from information_schema.columns where table_schema='public' order by table_name,ordinal_position`)
      ).rows,
    );
  }

  it('offers only eligible profiles belonging to a unique matching phone identity', async () => {
    const { service, userId } = await fixture((data) => {
      data.profiles.push({ ...data.profiles[0], _id: 'deleted-profile', isActive: false });
      data.profiles.push({ ...data.profiles[0], _id: 'orphan-profile', userId: 'missing-user' });
    });
    expect(await offer(service, userId)).toMatchObject({ profileCount: 1 });
    expect(await service.status(userId)).toEqual(await service.status(userId));
    expect(await ownerRows(userId)).toEqual({ subjects: [], life_profiles: [], audit_logs: [] });
  });

  it('normalizes a mainland phone with a country prefix before matching', async () => {
    const { service, userId } = await fixture((data, phone) => {
      data.users[0]!.phoneNumber = `+86${phone}`;
    });
    expect(await offer(service, userId)).toMatchObject({ profileCount: 1 });
  });

  it('does not offer data for missing, unmatched, ambiguous or inactive source owners', async () => {
    for (const kind of ['missing', 'unmatched', 'ambiguous', 'inactive'] as const) {
      const { service, userId } = await fixture((data) => {
        if (kind === 'missing') delete data.users[0]!.phoneNumber;
        if (kind === 'unmatched') data.users[0]!.phoneNumber = '13900000000';
        if (kind === 'inactive') data.users[0]!.isActive = false;
        if (kind === 'ambiguous') {
          data.users.push({ ...data.users[0], _id: 'second-owner', openid: 'second-openid' });
          data.profiles.push({
            ...data.profiles[0],
            _id: 'second-profile',
            userId: 'second-owner',
            openid: 'second-openid',
          });
        }
      });
      expect(await service.status(userId)).toMatchObject({ status: 'NONE' });
    }
    const { service } = await application();
    const noPhoneUserId = randomUUID();
    await pool.query('insert into users (id) values ($1)', [noPhoneUserId]);
    expect(await service.status(noPhoneUserId)).toMatchObject({ status: 'NONE' });
  });

  it('imports every accepted profile as an encrypted OTHER FRIEND without changing the schema or existing SELF', async () => {
    const { service, userId, cipher, data } = await fixture((source) => {
      source.profiles[0]!.profileName = '我自己';
      source.profiles.push({ ...source.profiles[0], _id: 'second-profile', profileName: '爸爸' });
    });
    const selfSubjectId = randomUUID();
    const selfProfileId = randomUUID();
    await pool.query(
      `insert into subjects (id,owner_user_id,type,display_name_ciphertext) values ($1,$2,'SELF',$3)`,
      [selfSubjectId, userId, cipher.encrypt('已有的本人')],
    );
    await pool.query(
      `insert into life_profiles (id,subject_id,owner_user_id,relationship_type) values ($1,$2,$3,'SELF')`,
      [selfProfileId, selfSubjectId, userId],
    );
    const existingSelf = (await pool.query('select * from life_profiles where id=$1', [selfProfileId])).rows;
    const schemaBefore = await structure();
    const offered = await offer(service, userId);
    expect(await decide(service, userId, offered.offerId, 'ACCEPT')).toMatchObject({
      status: 'COMPLETED',
      importedCount: 2,
    });
    const imported = (
      await pool.query<{
        id: string;
        type: string;
        relationship_type: string;
        active_revision_id: string | null;
        display_name_ciphertext: string;
      }>(
        `select lp.id,s.type,lp.relationship_type,lp.active_revision_id,s.display_name_ciphertext
         from life_profiles lp join subjects s on s.id=lp.subject_id
         where lp.owner_user_id=$1 and lp.id<>$2 order by lp.created_at,lp.id`,
        [userId, selfProfileId],
      )
    ).rows;
    expect(imported).toHaveLength(2);
    expect(imported.map((row) => cipher.decrypt(row.display_name_ciphertext)).sort()).toEqual([
      '我自己',
      '爸爸',
    ]);
    for (const row of imported) {
      expect(row).toMatchObject({ type: 'OTHER', relationship_type: 'FRIEND' });
      expect(typeof row.active_revision_id).toBe('string');
      expect(row.display_name_ciphertext).not.toContain('爸爸');
      const nativeRevision = (
        await pool.query<{
          status: string;
          birth_data_ciphertext: string;
          provider_location_id: string;
        }>(
          `select r.status,r.birth_data_ciphertext,l.provider_location_id
           from life_profile_revisions r join location_snapshots l on l.id=r.location_snapshot_id
           where r.id=$1`,
          [row.active_revision_id],
        )
      ).rows[0]!;
      expect(nativeRevision.status).toBe('ACTIVE');
      expect(nativeRevision.provider_location_id).toBe('geonames:1816670');
      expect(JSON.parse(cipher.decrypt(nativeRevision.birth_data_ciphertext))).toMatchObject({
        locationId: 'geonames:1816670',
        date: { year: 1990, month: 6, day: 15 },
        calculationGender: 'MALE',
        timePrecision: 'HOUR_RANGE',
        time: { localTime: null, hourBranchCode: 'SI' },
      });
      expect(
        (await pool.query('select id from card_bindings where revision_id=$1', [row.active_revision_id]))
          .rowCount,
      ).toBe(4);
      const original = await service.profileSource(userId, row.id);
      expect(original).toMatchObject({
        source: 'MINIAPP',
        profileName: cipher.decrypt(row.display_name_ciphertext),
        birthInput: {
          calendarType: 'SOLAR',
          date: { year: 1990, month: 6, day: 15 },
          calculationGender: 'MALE',
        },
        originalLocalTime: '10:30',
        timeUncertain: false,
        description: data.profiles[0]!.description,
      });
      for (const pillar of Object.values(original!.pillars)) expect(pillar).toMatch(/^.{2}$/u);
    }
    expect((await pool.query('select * from life_profiles where id=$1', [selfProfileId])).rows).toEqual(
      existingSelf,
    );
    expect(
      (await pool.query('select id from life_profile_revisions where owner_user_id=$1', [userId])).rowCount,
    ).toBe(2);
    expect(await structure()).toBe(schemaBefore);
    const audit = (await pool.query('select metadata from audit_logs where actor_user_id=$1', [userId])).rows;
    expect(JSON.stringify(audit)).not.toContain('仅用于合成测试的备注');
    expect(JSON.stringify(audit)).not.toContain('我自己');
  });

  it('permanently declines and does not allow a later acceptance, new archive or service restart to reopen the offer', async () => {
    const { service, userId, data } = await fixture();
    const offered = await offer(service, userId);
    expect(await decide(service, userId, offered.offerId, 'DECLINE')).toMatchObject({ status: 'DECLINED' });
    const before = await ownerRows(userId);
    expect(await service.status(userId)).toMatchObject({ status: 'DECLINED' });
    expect(await decide(service, userId, offered.offerId, 'ACCEPT')).toMatchObject({ status: 'DECLINED' });
    const updated = structuredClone(data);
    updated.namespace = `new-archive-${randomUUID()}`;
    updated.profiles.push({ ...updated.profiles[0], _id: 'newer-profile' });
    expect(await (await application(updated)).service.status(userId)).toMatchObject({ status: 'DECLINED' });
    expect(await (await application()).service.status(userId)).toMatchObject({ status: 'DECLINED' });
    expect(await ownerRows(userId)).toEqual(before);
    expect(before.subjects).toEqual([]);
    expect(before.life_profiles).toEqual([]);
    expect(before.audit_logs).not.toEqual([]);
  });

  it('preserves lunar birth dates and marks uncertain legacy times as DATE_ONLY while retaining the original clock time', async () => {
    const { service, userId, cipher } = await fixture((source) => {
      object(source.profiles[0]!.birthDate).isLunar = true;
      source.profiles[0]!.isUncertainTime = true;
    });
    const offered = await offer(service, userId);
    await decide(service, userId, offered.offerId, 'ACCEPT');
    const profile = (
      await pool.query<{ id: string; birth_data_ciphertext: string }>(
        `select lp.id,r.birth_data_ciphertext from life_profiles lp
         join life_profile_revisions r on r.id=lp.active_revision_id where lp.owner_user_id=$1`,
        [userId],
      )
    ).rows[0]!;
    expect(JSON.parse(cipher.decrypt(profile.birth_data_ciphertext))).toMatchObject({
      calendarType: 'LUNAR',
      date: { year: 1990, month: 6, day: 15, isLeapMonth: false },
      timePrecision: 'DATE_ONLY',
      time: { localTime: null, hourBranchCode: null },
    });
    expect(await service.profileSource(userId, profile.id)).toMatchObject({
      birthInput: { calendarType: 'LUNAR', date: { year: 1990, month: 6, day: 15 } },
      originalLocalTime: '10:30',
      timeUncertain: true,
    });
  });

  it('prevents the offline import CLI from bypassing a persisted refusal', async () => {
    const { service, userId, data } = await fixture();
    const offered = await offer(service, userId);
    await decide(service, userId, offered.offerId, 'DECLINE');
    const mapping = syntheticMapping(userId);
    mapping.namespace = data.namespace;
    const plan = await buildPlan(data, mapping);
    const before = await ownerRows(userId);
    const client = await pool.connect();
    try {
      await expect(
        executePlan(client, plan, {
          encryptionKey,
          cursorSecret: 'synthetic-consent-cursor-secret',
          commit: true,
        }),
      ).rejects.toThrow('MINIAPP_ONE_TIME_DECISION_ALREADY_RECORDED');
    } finally {
      client.release();
    }
    expect(await ownerRows(userId)).toEqual(before);
  });

  it('replays acceptance without creating duplicate records after idempotency records expire', async () => {
    const { service, userId, data } = await fixture();
    const offered = await offer(service, userId);
    const first = await decide(service, userId, offered.offerId, 'ACCEPT');
    const before = await ownerRows(userId);
    await pool.query('delete from idempotency_records where actor_key=$1', [`user:${userId}`]);
    expect(await decide(service, userId, offered.offerId, 'ACCEPT')).toEqual(first);
    expect(await decide(service, userId, offered.offerId, 'DECLINE')).toEqual(first);
    expect(await (await application(data)).service.status(userId)).toEqual(first);
    expect(await (await application()).service.status(userId)).toEqual(first);
    expect(await ownerRows(userId)).toEqual(before);
  });

  it('retains the once-only decline for the same account after its phone identity changes', async () => {
    const { service, userId, crypto } = await fixture();
    const offered = await offer(service, userId);
    await decide(service, userId, offered.offerId, 'DECLINE');
    await pool.query('update identities set provider_subject_hash=$1 where user_id=$2', [
      crypto.hash(`phone:+86139${randomUUID()}`),
      userId,
    ]);
    expect(await service.status(userId)).toMatchObject({ status: 'DECLINED' });
  });

  it('retains the once-only decline for the same phone after it is linked to a different account', async () => {
    const { service, userId } = await fixture();
    const offered = await offer(service, userId);
    await decide(service, userId, offered.offerId, 'DECLINE');
    const replacementUser = randomUUID();
    await pool.query('insert into users (id) values ($1)', [replacementUser]);
    await pool.query('update identities set user_id=$1 where user_id=$2', [replacementUser, userId]);
    expect(await service.status(replacementUser)).toMatchObject({ status: 'DECLINED' });
    expect(await ownerRows(replacementUser)).toEqual({ subjects: [], life_profiles: [], audit_logs: [] });
  });

  it('keeps accepted native birth data usable when the encrypted legacy source is unavailable', async () => {
    const { service, userId, cipher } = await fixture();
    const offered = await offer(service, userId);
    await decide(service, userId, offered.offerId, 'ACCEPT');
    const profile = (
      await pool.query<{ id: string; birth_data_ciphertext: string }>(
        `select lp.id,r.birth_data_ciphertext from life_profiles lp
         join life_profile_revisions r on r.id=lp.active_revision_id where lp.owner_user_id=$1`,
        [userId],
      )
    ).rows[0]!;
    const disconnected = (await application()).service;
    expect(await disconnected.status(userId)).toMatchObject({ status: 'COMPLETED', importedCount: 1 });
    await expect(disconnected.profileSource(userId, profile.id)).rejects.toMatchObject({ status: 503 });
    expect(JSON.parse(cipher.decrypt(profile.birth_data_ciphertext))).toMatchObject({
      date: { year: 1990, month: 6, day: 15 },
    });
  });

  it('commits only the first decision when different devices choose concurrently', async () => {
    const { service, userId } = await fixture();
    const offered = await offer(service, userId);
    const results = await Promise.all([
      decide(service, userId, offered.offerId, 'ACCEPT'),
      decide(service, userId, offered.offerId, 'DECLINE'),
      decide(service, userId, offered.offerId, 'ACCEPT'),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    const final = await service.status(userId);
    expect(['COMPLETED', 'DECLINED']).toContain(final.status);
    const rows = await ownerRows(userId);
    expect(rows.life_profiles).toHaveLength(final.status === 'COMPLETED' ? 1 : 0);
  });

  it('rejects a forged offer and prevents another account from reading imported private data', async () => {
    const first = await fixture();
    const second = await fixture();
    const offered = await offer(first.service, first.userId);
    await expect(decide(first.service, first.userId, randomUUID(), 'ACCEPT')).rejects.toThrow();
    expect(await ownerRows(first.userId)).toEqual({ subjects: [], life_profiles: [], audit_logs: [] });
    await expect(decide(first.service, second.userId, offered.offerId, 'ACCEPT')).rejects.toThrow();
    await decide(first.service, first.userId, offered.offerId, 'ACCEPT');
    const profileId = (
      await pool.query<{ id: string }>('select id from life_profiles where owner_user_id=$1', [first.userId])
    ).rows[0]!.id;
    await expect(first.service.profileSource(second.userId, profileId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(first.service.profileSource(first.userId, randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('preserves the first acceptance when an import fails, rolls back partial profiles and completes them through recovery', async () => {
    const { service, userId } = await fixture((source) => {
      source.profiles.push({
        ...source.profiles[0],
        _id: 'second-profile',
        profileName: '模拟失败的第二档案',
      });
    });
    const offered = await offer(service, userId);
    const nativeTables = [
      'life_profile_revisions',
      'location_snapshots',
      'astrology_snapshots',
      'card_bindings',
    ];
    const countsBefore: Record<string, number> = {};
    for (const table of nativeTables) {
      countsBefore[table] = Number(
        (await pool.query<{ count: string }>(`select count(*) from ${table}`)).rows[0]!.count,
      );
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The mock preserves the receiver with call(this).
    const encrypt = FieldCipher.prototype.encrypt;
    const spy = vi.spyOn(FieldCipher.prototype, 'encrypt').mockImplementation(function (
      this: FieldCipher,
      value,
    ) {
      if (value === '模拟失败的第二档案') throw new Error('SYNTHETIC_ENCRYPTION_FAILURE');
      return encrypt.call(this, value);
    });
    try {
      expect(await decide(service, userId, offered.offerId, 'ACCEPT')).toMatchObject({ status: 'ACCEPTED' });
      expect(await service.status(userId)).toMatchObject({ status: 'ACCEPTED' });
      // A temporary failure never reopens the choice or allows changing the recorded decision.
      expect(await decide(service, userId, offered.offerId, 'DECLINE')).toMatchObject({ status: 'ACCEPTED' });
      const partial = await ownerRows(userId);
      expect(partial.subjects).toEqual([]);
      expect(partial.life_profiles).toEqual([]);
      expect(partial.audit_logs).toHaveLength(1);
      const recorded = (
        await pool.query<{ metadata: { decision: string } }>(
          "select metadata from audit_logs where actor_user_id=$1 and action='MINIAPP_IMPORT_DECIDED'",
          [userId],
        )
      ).rows;
      expect(recorded.map((row) => row.metadata.decision)).toEqual(['ACCEPT']);
      for (const table of nativeTables) {
        expect(
          Number((await pool.query<{ count: string }>(`select count(*) from ${table}`)).rows[0]!.count),
        ).toBe(countsBefore[table]);
      }
      expect(await (await application()).service.status(userId)).toMatchObject({ status: 'ACCEPTED' });
    } finally {
      spy.mockRestore();
    }
    await service.recoverPendingImports();
    expect(await service.status(userId)).toMatchObject({
      status: 'COMPLETED',
      importedCount: 2,
    });
    const completed = await ownerRows(userId);
    await service.recoverPendingImports();
    expect(await ownerRows(userId)).toEqual(completed);
  });

  it('continues recovery beyond a full page of unavailable source archives', async () => {
    const unavailableUsers: string[] = [];
    try {
      for (let index = 0; index < 20; index++) {
        const userId = randomUUID();
        unavailableUsers.push(userId);
        await pool.query('insert into users (id) values ($1)', [userId]);
        await pool.query(
          `insert into audit_logs (id,actor_user_id,action,resource_type,resource_id,metadata,created_at)
           values ($1,$2,'MINIAPP_IMPORT_DECIDED','USER',$2,$3,now()-interval '1 day')`,
          [
            randomUUID(),
            userId,
            JSON.stringify({
              version: 1,
              decision: 'ACCEPT',
              status: 'ACCEPTED',
              sourceUserHash: `synthetic-unavailable-${index}`,
              archiveHash: 'synthetic-unavailable',
              profileMarkerIds: [],
            }),
          ],
        );
      }
      const { service, userId, cipher } = await fixture();
      const offered = await offer(service, userId);
      const spy = vi.spyOn(cipher, 'encrypt').mockImplementation(() => {
        throw new Error('SYNTHETIC_ENCRYPTION_FAILURE');
      });
      try {
        expect(await decide(service, userId, offered.offerId, 'ACCEPT')).toMatchObject({
          status: 'ACCEPTED',
        });
      } finally {
        spy.mockRestore();
      }
      await service.recoverPendingImports();
      await service.recoverPendingImports();
      expect(await service.status(userId)).toMatchObject({ status: 'COMPLETED', importedCount: 1 });
    } finally {
      if (unavailableUsers.length) {
        await pool.query('delete from audit_logs where actor_user_id=any($1::uuid[])', [unavailableUsers]);
        await pool.query('delete from users where id=any($1::uuid[])', [unavailableUsers]);
      }
    }
  });

  it.skipIf(!process.env.MINIAPP_REAL_ARCHIVE_PATH || !process.env.MINIAPP_REAL_KEY_PATH)(
    'imports a representative real-export account after consent without exposing any private values in assertions',
    async () => {
      const archive = await loadArchive(
        process.env.MINIAPP_REAL_ARCHIVE_PATH!,
        process.env.MINIAPP_REAL_KEY_PATH!,
      );
      const phoneCounts = new Map<string, number>();
      for (const user of archive.users) {
        const phone = normalizeMiniappPhone(user.phoneNumber);
        if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);
      }
      const assessment = assessSource(archive);
      const eligibleCounts = new Map<string, number>();
      for (const profile of assessment.profiles) {
        if (profile.disposition === 'ELIGIBLE') {
          eligibleCounts.set(profile.sourceUserId, (eligibleCounts.get(profile.sourceUserId) ?? 0) + 1);
        }
      }
      const candidates = archive.users
        .filter((user) => {
          const phone = normalizeMiniappPhone(user.phoneNumber);
          return (
            user.isActive === true &&
            phone &&
            phoneCounts.get(phone) === 1 &&
            eligibleCounts.has(String(user._id))
          );
        })
        .sort(
          (left, right) => eligibleCounts.get(String(right._id))! - eligibleCounts.get(String(left._id))!,
        );
      expect(candidates.length > 0).toBe(true);
      const selected = candidates[0]!;
      const eligible = new Set(
        assessment.profiles
          .filter((profile) => profile.sourceUserId === selected._id && profile.disposition === 'ELIGIBLE')
          .map((profile) => profile.sourceProfileId),
      );
      const data: SourceData = {
        version: 1,
        namespace: `real-consent-test-${randomUUID()}`,
        users: [selected],
        profiles: archive.profiles.filter((profile) => eligible.has(String(profile._id))),
      };
      const { service, crypto, cipher } = await application(data, `real-test-${randomUUID()}`);
      const userId = randomUUID();
      const phone = normalizeMiniappPhone(selected.phoneNumber)!;
      await pool.query('insert into users (id) values ($1)', [userId]);
      await pool.query(
        `insert into identities (id,user_id,provider,provider_subject_hash,phone_ciphertext)
         values ($1,$2,'PHONE',$3,$4)`,
        [randomUUID(), userId, crypto.hash(`phone:${phone}`), cipher.encrypt(phone)],
      );
      const offered = await offer(service, userId);
      expect(offered.profileCount).toBe(data.profiles.length);
      const imported = await decide(service, userId, offered.offerId, 'ACCEPT');
      expect(imported).toMatchObject({ status: 'COMPLETED', importedCount: data.profiles.length });
      expect(await service.status(userId)).toEqual(imported);
      const live = await pool.query<{ relationship_type: string; type: string; status: string }>(
        `select lp.relationship_type,s.type,r.status from life_profiles lp
         join subjects s on s.id=lp.subject_id join life_profile_revisions r on r.id=lp.active_revision_id
         where lp.owner_user_id=$1`,
        [userId],
      );
      expect(live.rowCount).toBe(data.profiles.length);
      expect(
        live.rows.every(
          (row) => row.type === 'OTHER' && row.relationship_type === 'FRIEND' && row.status === 'ACTIVE',
        ),
      ).toBe(true);
      const before = await ownerRows(userId);
      expect(await decide(service, userId, offered.offerId, 'ACCEPT')).toEqual(imported);
      expect(digest(await ownerRows(userId))).toBe(digest(before));
    },
    30000,
  );
});
