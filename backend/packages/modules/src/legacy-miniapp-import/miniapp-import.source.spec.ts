import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FieldCipher, type RuntimeInfrastructure } from '@satori/infrastructure';
import { AuthCrypto } from '../identity/auth/auth.crypto.js';
import { syntheticSource } from './fixtures.js';
import { MiniappImportSource, miniappProfileMarker } from './miniapp-import.source.js';
import { digest, type SourceData } from './source.js';

const key = '44'.repeat(32);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'miniapp-history-unit-'));
  directories.push(path);
  return path;
}

async function archive(path: string, source: SourceData) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await writeFile(join(path, 'archive.key'), key, { mode: 0o600 });
  await writeFile(
    join(path, 'source.encrypted.json'),
    JSON.stringify({
      version: 1,
      sourceHash: digest(source),
      ciphertext: new FieldCipher(key).encrypt(JSON.stringify(source)),
    }),
    { mode: 0o600 },
  );
}

async function provider(source: SourceData | null, historyPath?: string) {
  const path = await directory();
  if (source) await archive(path, source);
  const infrastructure = {
    environment: {
      AUTH_HMAC_SECRET: 'synthetic-unit-history-hmac-secret',
      ...(source
        ? {
            MINIAPP_IMPORT_ARCHIVE_PATH: join(path, 'source.encrypted.json'),
            MINIAPP_IMPORT_KEY_PATH: join(path, 'archive.key'),
          }
        : {}),
      ...(historyPath ? { MINIAPP_IMPORT_HISTORY_PATH: historyPath } : {}),
    },
  } as unknown as RuntimeInfrastructure;
  const result = new MiniappImportSource(
    infrastructure,
    new AuthCrypto(infrastructure, new FieldCipher(key)),
  );
  await result.onModuleInit();
  return result;
}

describe('immutable miniapp source history', () => {
  it('offers active profiles with stale miniapp user ids through one unique openid and one phone', async () => {
    const original = await syntheticSource();
    original.profiles[0]!.userId = 'stale-user-id';
    const source = await provider(original);
    const infrastructure = {
      environment: { AUTH_HMAC_SECRET: 'synthetic-unit-history-hmac-secret' },
    } as unknown as RuntimeInfrastructure;
    const crypto = new AuthCrypto(infrastructure, new FieldCipher(key));
    const match = source.match(crypto.hash('phone:+8613800000000'));
    expect(match?.sourceUserId).toBe('old-user');
    expect(match?.profiles.map((profile) => profile.original._id)).toEqual(['old-profile']);
  });

  it('reads an unchanged original after unrelated archive content changes, using the imported profile hash', async () => {
    const original = await syntheticSource();
    const updated = structuredClone(original);
    updated.users.push({ _id: 'unrelated-user', openid: 'unrelated-openid', isActive: true });
    const source = await provider(updated);
    const marker = miniappProfileMarker(original.namespace, 'old-profile');
    expect(await source.original(marker, digest(original), digest(original.profiles[0]))).toMatchObject({
      profileName: '测试档案',
      description: '仅用于合成测试的备注',
    });
    expect(await source.original(marker, digest(original))).toBeNull();
  });

  it('does not present changed profile data as the imported snapshot when history is absent', async () => {
    const original = await syntheticSource();
    const updated = structuredClone(original);
    updated.profiles[0]!.profileName = '后来修改的档案';
    const source = await provider(updated);
    expect(
      await source.original(
        miniappProfileMarker(original.namespace, 'old-profile'),
        digest(original),
        digest(original.profiles[0]),
      ),
    ).toBeNull();
  });

  it('reads the exact old profile from retained encrypted history, including when the current archive is disabled', async () => {
    const original = await syntheticSource();
    const updated = structuredClone(original);
    updated.profiles[0]!.profileName = '后来修改的档案';
    const history = await directory();
    await archive(join(history, digest(original)), original);
    for (const active of [updated, null]) {
      const source = await provider(active, history);
      const marker = miniappProfileMarker(original.namespace, 'old-profile');
      const snapshot = await source.original(marker, digest(original), digest(original.profiles[0]));
      expect(snapshot).toMatchObject({ profileName: '测试档案', originalLocalTime: '10:30' });
      expect(snapshot).not.toHaveProperty('userId');
      expect(snapshot).not.toHaveProperty('openid');
      expect(await source.original(marker, digest(original), digest({ unmatched: 'profile' }))).toBeNull();
    }
  });

  it('rejects missing or wrong history keys without falling back to the changed current record', async () => {
    const original = await syntheticSource();
    const updated = structuredClone(original);
    updated.profiles[0]!.description = '后来修改的备注';
    const history = await directory();
    const retained = join(history, digest(original));
    await archive(retained, original);
    const source = await provider(updated, history);
    const marker = miniappProfileMarker(original.namespace, 'old-profile');
    await writeFile(join(retained, 'archive.key'), '55'.repeat(32));
    expect(await source.original(marker, digest(original), digest(original.profiles[0]))).toBeNull();
    await rm(join(retained, 'archive.key'));
    expect(await source.original(marker, digest(original), digest(original.profiles[0]))).toBeNull();
    await writeFile(join(retained, 'archive.key'), key, { mode: 0o600 });
    expect(await source.original(marker, digest(original), digest(original.profiles[0]))).toMatchObject({
      description: '仅用于合成测试的备注',
    });
  });

  it('verifies the retained archive against its directory hash and rejects path fragments', async () => {
    const original = await syntheticSource();
    const updated = structuredClone(original);
    updated.profiles[0]!.profileName = '不是旧快照';
    const history = await directory();
    await archive(join(history, digest(original)), updated);
    const source = await provider(null, history);
    const marker = miniappProfileMarker(original.namespace, 'old-profile');
    expect(await source.original(marker, digest(original), digest(original.profiles[0]))).toBeNull();
    expect(await source.original(marker, '../outside', digest(original.profiles[0]))).toBeNull();
    expect(await source.original(marker, digest(original), '../outside')).toBeNull();
  });

  it('restores a persisted acceptance from its exact old source independently of current phone and archive changes', async () => {
    const original = await syntheticSource();
    const updated = structuredClone(original);
    updated.users[0]!.phoneNumber = '13900000000';
    updated.profiles[0]!.profileName = '新包的内容';
    const history = await directory();
    await archive(join(history, digest(original)), original);
    const source = await provider(updated, history);
    const match = await source.acceptedMatch(digest([original.namespace, 'old-user']), digest(original));
    expect(match?.sourceUserId).toBe('old-user');
    expect(match?.sourceHash).toBe(digest(original));
    expect(match?.profiles.map((item) => item.original.profileName)).toEqual(['测试档案']);
    expect(
      await source.acceptedMatch(digest([original.namespace, 'another-user']), digest(original)),
    ).toBeNull();
    expect(await source.acceptedMatch('../outside', digest(original))).toBeNull();
  });

  it('resolves a persisted acceptance from the unchanged active archive without requiring a history directory', async () => {
    const original = await syntheticSource();
    const source = await provider(original);
    expect(
      await source.acceptedMatch(digest([original.namespace, 'old-user']), digest(original)),
    ).toMatchObject({
      sourceUserId: 'old-user',
      sourceHash: digest(original),
    });
  });
});
