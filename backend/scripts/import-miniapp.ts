import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import {
  loadArchive,
  prepareArchive,
  writePrivateJson,
} from '../packages/modules/src/legacy-miniapp-import/archive.js';
import { assessSource } from '../packages/modules/src/legacy-miniapp-import/source.js';
import { buildPlan } from '../packages/modules/src/legacy-miniapp-import/plan.js';
import { executePlan } from '../packages/modules/src/legacy-miniapp-import/importer.js';
import { verifyArchive } from '../packages/modules/src/legacy-miniapp-import/verify.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    users: { type: 'string' },
    profiles: { type: 'string' },
    out: { type: 'string' },
    namespace: { type: 'string' },
    archive: { type: 'string' },
    key: { type: 'string' },
    mapping: { type: 'string' },
    report: { type: 'string' },
    commit: { type: 'boolean', default: false },
    'confirm-database': { type: 'string' },
    help: { type: 'boolean' },
  },
});
function required(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw new Error(`REQUIRED_OPTION:${name}`);
  return value;
}

async function main() {
  const command = positionals[0];
  if (values.help || !command) {
    console.info(`小程序档案迁移工具（不会创建账号或修改数据库结构）
prepare --users <JSON/JSONL> --profiles <JSON/JSONL> --out <新目录> --namespace <固定来源标识>
review  --archive <source.encrypted.json> --key <archive.key> --out <新 JSON 文件>
verify  --archive <文件> --key <文件> --out <新 JSON 报告>（全量离线测试，不生成真实账号映射）
plan    --archive <文件> --key <文件> --mapping <已核验映射> --out <新 JSON 文件>
apply   --archive <文件> --key <文件> --mapping <已核验映射> --report <新 JSON 文件>
        [--commit --confirm-database <数据库名>]
apply 默认执行完整事务后回滚。提交须显式设置 MINIAPP_TARGET_DATABASE_URL、
DATA_ENCRYPTION_KEY、CURSOR_SIGNING_SECRET，并提供 --commit 和数据库名确认。
prepare/review/plan 不连接数据库；review/plan 的输出含个人资料，应保存在私有目录。`);
    return;
  }
  if (positionals.length !== 1 || !['prepare', 'review', 'verify', 'plan', 'apply'].includes(command))
    throw new Error('INVALID_COMMAND');
  if (values.commit && command !== 'apply') throw new Error('COMMIT_ONLY_ALLOWED_WITH_APPLY');
  if (command === 'prepare') {
    console.info(
      JSON.stringify(
        await prepareArchive({
          usersPath: required('users'),
          profilesPath: required('profiles'),
          out: required('out'),
          namespace: required('namespace'),
        }),
        null,
        2,
      ),
    );
    return;
  }
  const source = await loadArchive(required('archive'), required('key'));
  if (command === 'verify') {
    const report = await verifyArchive(source);
    await writePrivateJson(required('out'), report);
    console.info(JSON.stringify(report, null, 2));
    return;
  }
  if (command === 'review') {
    await writePrivateJson(required('out'), { assessment: assessSource(source), source });
    console.info('私有核对文件已生成。');
    return;
  }
  const plan = await buildPlan(source, JSON.parse(await readFile(required('mapping'), 'utf8')));
  if (command === 'plan') {
    await writePrivateJson(required('out'), plan);
    console.info(
      JSON.stringify({
        selectedProfiles: plan.profiles.length,
        changedCardProfiles: plan.profiles.filter((item) => item.changedPillars.length).length,
      }),
    );
    return;
  }
  const connectionString = process.env.MINIAPP_TARGET_DATABASE_URL;
  const encryptionKey = process.env.DATA_ENCRYPTION_KEY;
  const cursorSecret = process.env.CURSOR_SIGNING_SECRET;
  if (!connectionString || !encryptionKey || !cursorSecret) throw new Error('EXPLICIT_TARGET_ENV_REQUIRED');
  // Require a new report file before any transaction can commit.
  const reportPath = required('report');
  await writePrivateJson(reportPath, { state: 'STARTED', committed: null });
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    const result = await client.query<{ name: string }>('select current_database() as name');
    if (values.commit && required('confirm-database') !== result.rows[0]?.name)
      throw new Error('DATABASE_CONFIRMATION_MISMATCH');
    const outcome = await executePlan(client, plan, {
      encryptionKey,
      cursorSecret,
      commit: values.commit ?? false,
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(reportPath, `${JSON.stringify(outcome, null, 2)}\n`, { mode: 0o600 });
    console.info(
      JSON.stringify({
        committed: outcome.committed,
        selectedProfiles: outcome.results.length,
        imported: outcome.committed ? outcome.results.filter((item) => item.state === 'IMPORTED').length : 0,
        wouldImport: outcome.committed
          ? 0
          : outcome.results.filter((item) => item.state === 'IMPORTED').length,
        replayed: outcome.results.filter((item) => item.state === 'REPLAYED').length,
      }),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Do not print PostgreSQL detail, paths, raw records, SQL parameters or Zod input data.
  const message =
    error instanceof Error && /^[A-Z_]+(?::[a-zA-Z_0-9]+)?$/.test(error.message)
      ? error.message
      : 'IMPORT_FAILED_SEE_PRIVATE_INPUT_AND_DOCUMENTATION';
  console.error(message);
  process.exitCode = 1;
});
