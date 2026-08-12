import { validateEnvironment } from '../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../packages/infrastructure/src/database/client.js';
import { legalDocuments } from '../packages/infrastructure/src/database/schema.js';
import './seed-card-catalog.js';

const publishedAt = new Date('2026-08-09T00:00:00.000Z');
const documents: (typeof legalDocuments.$inferInsert)[] = [
  {
    documentId: 'legal_privacy_20260809',
    type: 'PRIVACY_POLICY',
    version: '1.0',
    title: '隐私政策',
    content: '# 隐私政策\n\nR1.0 协议版本占位正文。生产发布前必须由隐私与法务负责人替换并审批。',
    publishedAt,
  },
  {
    documentId: 'legal_terms_20260809',
    type: 'TERMS_OF_SERVICE',
    version: '1.0',
    title: '用户协议',
    content: '# 用户协议\n\nR1.0 协议版本占位正文。生产发布前必须由隐私与法务负责人替换并审批。',
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
  await database.insert(legalDocuments).values(documents).onConflictDoNothing();
} finally {
  await pool.end();
}
