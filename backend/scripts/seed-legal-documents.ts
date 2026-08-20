import { readFile } from 'node:fs/promises';
import { inArray, sql } from 'drizzle-orm';
import { validateEnvironment } from '../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../packages/infrastructure/src/database/client.js';
import { legalDocuments } from '../packages/infrastructure/src/database/schema.js';
import './seed-card-catalog.js';

const publishedAt = new Date('2026-08-20T00:00:00.000Z');
const [privacyPolicy, termsOfService] = await Promise.all([
  readFile(new URL('../assets/legal/privacy-v1.1.md', import.meta.url), 'utf8'),
  readFile(new URL('../assets/legal/terms-v1.1.md', import.meta.url), 'utf8'),
]);

const documents: (typeof legalDocuments.$inferInsert)[] = [
  {
    documentId: 'legal_privacy_20260820',
    type: 'PRIVACY_POLICY',
    version: '1.1',
    title: '隐私政策',
    content: privacyPolicy,
    publishedAt,
  },
  {
    documentId: 'legal_terms_20260820',
    type: 'TERMS_OF_SERVICE',
    version: '1.1',
    title: '用户协议',
    content: termsOfService,
    publishedAt,
  },
  {
    documentId: 'legal_ai_notice_20260809',
    type: 'AI_CONTENT_NOTICE',
    version: '1.0',
    title: 'AI 内容说明',
    content: '# AI 内容说明\n\nR1.0 协议版本占位正文。生产发布前必须由内容安全与法务负责人替换并审批。',
    publishedAt,
  },
];

const { pool, database } = createDatabase(validateEnvironment(process.env));

try {
  await database.transaction(async (tx) => {
    await tx
      .update(legalDocuments)
      .set({ required: false })
      .where(
        inArray(legalDocuments.documentId, [
          'legal_privacy_20260809',
          'legal_terms_20260809',
        ]),
      );
    await tx
      .insert(legalDocuments)
      .values(documents)
      .onConflictDoUpdate({
        target: legalDocuments.documentId,
        set: {
          required: true,
          content: sql`excluded.content`,
          publishedAt: sql`excluded.published_at`,
        },
      });
  });
} finally {
  await pool.end();
}
