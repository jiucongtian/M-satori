# Satori R1.0 Backend

Node.js 22、NestJS/Fastify 模块化单体。`apps/api` 与 `apps/worker` 独立运行，共享 `packages/` 中的契约、领域、应用与基础设施代码。

## 本地启动

```bash
cp .env.example .env
npm install
npm run infra:up
npm run db:migrate
npm run dev:api
```

`.env.example` 中每个部署变量均说明用途、允许值和影响范围；可选变量未启用时应整行省略。完整配置分层、版本化策略和测试专用变量见 [`docs/backend/R1.0-configuration-reference.md`](../docs/backend/R1.0-configuration-reference.md)。

另开终端运行 `npm run dev:worker`。提交前运行：

```bash
npm run typecheck && npm run lint && npm test
```

## 数据库约定

- 应用 ID 使用 UUIDv7；时间戳统一写入 PostgreSQL `timestamptz`，业务展示时才转换用户生活时区。
- 迁移文件由 `npm run db:generate` 生成、经评审后用 `npm run db:migrate` 执行，已在任何共享环境执行的迁移不得重写。
- 破坏性变更遵循 expand/contract：先增加兼容结构并双写/回填，再切换读取，最后在独立发布中收缩旧结构。
- revision、consent、audit 与 seed ledger 是历史事实，只能追加或状态迁移，不做静默覆盖或物理删除。
- API 事务必须通过数据库事务边界完成；Redis 锁不能替代唯一约束、行锁或 Outbox。

## 队列约定

PostgreSQL GenerationTask/Outbox 是事实源，BullMQ 只负责投递。默认指数退避、最多 5 次，API 与 Worker 在停机时须停止接收新任务并关闭 Queue/Redis/Pool。Redis 不可用时由 Outbox 后续补投，查询退化到 PostgreSQL。
