import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FieldCipher } from '../../../infrastructure/src/security/field-cipher.js';
import { assessSource, digest, parseExport, type SourceData } from './source.js';

export async function writePrivateJson(path: string, data: unknown) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

export async function prepareArchive(input: {
  usersPath: string;
  profilesPath: string;
  out: string;
  namespace: string;
}) {
  const [usersText, profilesText] = await Promise.all([
    readFile(input.usersPath, 'utf8'),
    readFile(input.profilesPath, 'utf8'),
  ]);
  const source: SourceData = {
    version: 1,
    namespace: input.namespace,
    users: parseExport(usersText),
    profiles: parseExport(profilesText),
  };
  const assessment = assessSource(source);
  const key = randomBytes(32).toString('hex');
  const sourceHash = digest(source);
  const cipher = new FieldCipher(key);
  // Refuse to overwrite an old batch or leave private records in an existing public directory.
  await mkdir(input.out, { mode: 0o700, recursive: false });
  await writeFile(join(input.out, 'archive.key'), `${key}\n`, { mode: 0o600, flag: 'wx' });
  await writePrivateJson(join(input.out, 'source.encrypted.json'), {
    version: 1,
    sourceHash,
    ciphertext: cipher.encrypt(JSON.stringify(source)),
  });
  await writePrivateJson(join(input.out, 'report.json'), {
    version: 1,
    namespace: input.namespace,
    sourceHash,
    generatedAt: new Date().toISOString(),
    ...assessment.summary,
    importedProfiles: 0,
  });
  await writePrivateJson(join(input.out, 'review.encrypted.json'), {
    version: 1,
    ciphertext: cipher.encrypt(JSON.stringify(assessment.profiles)),
  });
  await writePrivateJson(join(input.out, 'mapping.template.json'), {
    version: 1,
    namespace: input.namespace,
    users: [],
    profiles: [],
  });
  return { sourceHash, ...assessment.summary, importedProfiles: 0 };
}

export async function loadArchive(archivePath: string, keyPath: string): Promise<SourceData> {
  const [raw, keyText] = await Promise.all([readFile(archivePath, 'utf8'), readFile(keyPath, 'utf8')]);
  const key = keyText.trim();
  if (!/^[a-f\d]{64}$/i.test(key)) throw new Error('INVALID_ARCHIVE_KEY');
  const envelope = JSON.parse(raw) as { version: number; sourceHash: string; ciphertext: string };
  if (envelope.version !== 1) throw new Error('INVALID_ARCHIVE_VERSION');
  const source = JSON.parse(new FieldCipher(key).decrypt(envelope.ciphertext)) as SourceData;
  if (digest(source) !== envelope.sourceHash) throw new Error('SOURCE_CHECKSUM_MISMATCH');
  assessSource(source);
  return source;
}
