import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { assessSource, digest, object, parseExport, sourceDate } from './source.js';
import { prepareArchive, loadArchive } from './archive.js';
import { buildPlan } from './plan.js';
import { syntheticMapping, syntheticSource } from './fixtures.js';
import { verifyArchive } from './verify.js';

const paths: string[] = [];
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('miniapp source preservation and validation', () => {
  it('reads arrays, wrappers and BOM/CRLF NDJSON without losing date or nested fields', () => {
    const rows = [
      {
        _id: 'a',
        birthDate: { minute: 0, isLeapMonth: false },
        createTime: { $date: '2024-01-02T00:00:00Z' },
      },
      { _id: 'b' },
    ];
    for (const text of [
      JSON.stringify(rows),
      JSON.stringify({ data: rows }),
      '\uFEFF' + rows.map((row) => JSON.stringify(row)).join('\r\n'),
    ]) {
      expect(parseExport(text)).toEqual(rows);
    }
    expect(sourceDate({ $date: { $numberLong: '1704153600000' } })?.toISOString()).toBe(
      '2024-01-02T00:00:00.000Z',
    );
    expect(() => parseExport('{bad}\n')).toThrow('INVALID_JSON_LINE');
    expect(() => parseExport('')).toThrow('EMPTY_EXPORT');
  });

  it('quarantines orphan ownership even when its openid could match another user', async () => {
    const source = await syntheticSource();
    source.profiles[0]!.userId = 'missing';
    const assessed = assessSource(source).profiles[0]!;
    expect(assessed.disposition).toBe('QUARANTINED');
    expect(assessed.issues).toContain('SOURCE_USER_NOT_FOUND');
    expect(assessed.issues).toContain('STALE_USER_ID_POSSIBLE');
  });

  it('does not resurrect deleted profiles and rejects duplicate IDs or ambiguous openids', async () => {
    const source = await syntheticSource();
    source.profiles[0]!.isActive = false;
    expect(assessSource(source).summary.deletedProfiles).toBe(1);
    await expect(buildPlan(source, syntheticMapping(randomUUID()))).rejects.toThrow('PROFILE_NOT_ELIGIBLE');
    source.profiles[0]!.isActive = true;
    source.users.push({ ...source.users[0], _id: 'second' });
    expect(assessSource(source).summary.quarantinedProfiles).toBe(1);
    source.profiles.push({ ...source.profiles[0] });
    expect(() => assessSource(source)).toThrow('DUPLICATE_ID');
  });

  it('rejects invalid solar dates and lunar dates, preserving source records unchanged', async () => {
    for (const birth of [
      { year: 2025, month: 2, day: 30, isLunar: false },
      { year: 2025, month: 1, day: 31, isLunar: true },
    ]) {
      const source = await syntheticSource();
      Object.assign(object(source.profiles[0]!.birthDate), birth);
      const before = digest(source);
      expect(assessSource(source).profiles[0]!.issues).toContain('BIRTH_DATE_INVALID');
      expect(digest(source)).toBe(before);
    }
  });

  it('does not invent lunar leap flags, but accepts old solar records without one', async () => {
    const source = await syntheticSource();
    delete object(source.profiles[0]!.birthDate).isLeapMonth;
    expect(assessSource(source).summary.eligibleProfiles).toBe(1);
    object(source.profiles[0]!.birthDate).isLunar = true;
    expect(assessSource(source).profiles[0]!.issues).toContain('LUNAR_LEAP_FLAG_MISSING');
  });

  it('encrypts and roundtrips every original field; report contains no identity or birth values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miniapp-source-test-'));
    paths.push(root);
    const source = await syntheticSource();
    const usersPath = join(root, 'users.json');
    const profilesPath = join(root, 'profiles.json');
    const out = join(root, 'output');
    await writeFile(usersPath, source.users.map((row) => JSON.stringify(row)).join('\n'));
    await writeFile(profilesPath, JSON.stringify(source.profiles));
    await prepareArchive({ usersPath, profilesPath, out, namespace: source.namespace });
    expect(await loadArchive(join(out, 'source.encrypted.json'), join(out, 'archive.key'))).toEqual(source);
    for (const file of ['source.encrypted.json', 'review.encrypted.json', 'report.json']) {
      const text = await readFile(join(out, file), 'utf8');
      expect(text).not.toContain('synthetic-openid');
      expect(text).not.toContain('测试档案');
      expect((await stat(join(out, file))).mode & 0o777).toBe(0o600);
    }
    await expect(
      prepareArchive({ usersPath, profilesPath, out, namespace: source.namespace }),
    ).rejects.toThrow();
    const envelope = object(JSON.parse(await readFile(join(out, 'source.encrypted.json'), 'utf8')));
    envelope.sourceHash = 'tampered';
    await writeFile(join(out, 'source.encrypted.json'), JSON.stringify(envelope));
    await expect(loadArchive(join(out, 'source.encrypted.json'), join(out, 'archive.key'))).rejects.toThrow(
      'SOURCE_CHECKSUM_MISMATCH',
    );
  });
});

describe('miniapp reviewed import planning', () => {
  it('full offline verification never emits a usable synthetic claim or changes source records', async () => {
    const source = await syntheticSource();
    const before = digest(source);
    const result = await verifyArchive(source);
    expect(result.calculatedProfiles).toBe(1);
    expect(result.importedProfiles).toBe(0);
    expect(result.verifiedRealAccounts).toBe(0);
    expect(typeof result.profiles).toBe('number');
    expect(result).not.toHaveProperty('mapping');
    expect(JSON.stringify(result)).not.toContain('old-user');
    expect(digest(source)).toBe(before);
  });
  it('requires verified owners, explicit birthplace and explicit confirmation, regardless of phone values', async () => {
    const source = await syntheticSource();
    const mapping = syntheticMapping(randomUUID());
    await expect(buildPlan(source, { ...mapping, users: [] })).rejects.toThrow(
      'VERIFIED_OWNER_MAPPING_REQUIRED',
    );
    await expect(
      buildPlan(source, { ...mapping, profiles: [{ ...mapping.profiles[0], locationId: '' }] }),
    ).rejects.toThrow();
    await expect(
      buildPlan(source, { ...mapping, profiles: [{ ...mapping.profiles[0], confirmed: false }] }),
    ).rejects.toThrow();
    await expect(
      buildPlan(source, { ...mapping, users: [{ ...mapping.users[0], verification: undefined }] }),
    ).rejects.toThrow();
    const plan = await buildPlan(source, mapping);
    expect(plan.profiles[0]!.birthInput).toMatchObject({
      calculationGender: 'MALE',
      locationId: 'geonames:1816670',
      time: { localTime: '10:30' },
    });
    expect(plan.profiles[0]!.original).toEqual(source.profiles[0]);
    expect(plan.profiles[0]!.changedPillars).toEqual([]);
  });

  it('preserves female=0 and unknown time, detecting card changes without overwriting the old cards', async () => {
    const source = await syntheticSource();
    const beforeCards = digest(source.profiles[0]!.baziData);
    source.profiles[0]!.gender = 0;
    source.profiles[0]!.isUncertainTime = true;
    const mapping = syntheticMapping(randomUUID());
    await expect(buildPlan(source, mapping)).rejects.toThrow('UNKNOWN_TIME_MUST_REMAIN_DATE_ONLY');
    mapping.profiles[0]!.timePrecision = 'DATE_ONLY';
    await expect(buildPlan(source, mapping)).rejects.toThrow('RECALCULATED_CARDS_REQUIRE_ACCEPTANCE');
    mapping.profiles[0]!.acceptRecalculatedCards = true;
    const plan = await buildPlan(source, mapping);
    expect(plan.profiles[0]!.birthInput).toMatchObject({
      calculationGender: 'FEMALE',
      time: { localTime: null, hourBranchCode: null },
    });
    expect(plan.profiles[0]!.changedPillars).toContain('hour');
    expect(digest(plan.profiles[0]!.original.baziData)).toBe(beforeCards);
  });

  it('rejects duplicate selections and missing hour branches', async () => {
    const source = await syntheticSource();
    const mapping = syntheticMapping(randomUUID());
    await expect(
      buildPlan(source, { ...mapping, profiles: [...mapping.profiles, ...mapping.profiles] }),
    ).rejects.toThrow('DUPLICATE_PROFILE_SELECTION');
    mapping.profiles[0]!.timePrecision = 'HOUR_RANGE';
    await expect(buildPlan(source, mapping)).rejects.toThrow('HOUR_BRANCH_PRECISION_MISMATCH');
  });
});
