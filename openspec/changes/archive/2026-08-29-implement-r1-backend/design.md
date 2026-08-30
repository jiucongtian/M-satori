## Context

R1.0 前端已经冻结九项功能，但仍为 `CONTRACT_DEFINED / CONTRACT_PROPOSED + MOCK_UI`，`backend/` 尚无可运行服务。接口具体形式已有 2026-08-09 API v1 讨论稿，新版 2026-08-10 交接文档又把多人档案、智慧种子和四张关系卡牌纳入 R1.0。`docs/adr/0001-r1-release-source-priority.md` 已确定：新版交接决定产品范围，API 文档决定 `CONTRACT_DEFINED` 形式，架构文档决定技术实现。

因此本设计覆盖 R1.0 九项能力及其必要的认证、consent、GenerationTask/SSE、账务和运维基础；不实现独立人生报告、旧产品权益接口或 R1.1 卡牌业务。所有 API 使用 `/api/v1`，不能把产品 Release 标签映射为 API 路径。

## Goals / Non-Goals

**Goals:**

- 交付可独立运行、迁移、测试和部署的 R1.0 API 与 Worker，覆盖交接矩阵全部阻塞接口。
- 以 OpenAPI 3.1 作为前后端单一契约事实源，复用既有 API v1 method/path、envelope、Cookie、错误和幂等语义。
- 保证验证码登录、协议同意、档案 preview/confirm、四张卡牌、种子账务、注册赠礼和每日指引可追溯且幂等。
- 提供可恢复的通用 GenerationTask、SSE 与轮询降级，为每日指引和 R1.1 提供稳定基础。
- 让短信、地点、排盘和 Aqua/内容生成能力可以替换，并具备确定性测试适配器。

**Non-Goals:**

- 不实现 R1.1 抽卡问事，以及成长、关系报告、商品、订单、会员和支付。
- 不交付独立人生报告列表/详情或 `/me/entitlements`；每日指引直接基于 Active Profile、四张卡牌和版本化内容上下文。
- 不改动冻结的 R1.0 页面结构、视觉与文案。
- 不拆微服务，不引入 Kafka、服务网格或 Kubernetes 强依赖。

## Decisions

### 1. NestJS/TypeScript 模块化单体，API 与 Worker 分开部署

后端采用 Node.js 22、TypeScript、NestJS Fastify adapter。代码按 identity、profile、astrology、profile-library、seed-ledger、generation-task、daily-insight、feedback、operations 与 integrations 划分领域模块；`apps/api` 接收 REST/SSE，`apps/worker` 执行异步编排，两者共享 application/domain/contracts/infrastructure packages。

该方案遵守架构基线并与前端共享语言生态。模块只通过应用服务或事件交互，Controller 不直接访问 ORM，也不跨模块操作 repository。

### 2. PostgreSQL 保存事实，Redis/BullMQ 承载队列与实时事件

PostgreSQL 与 Drizzle 保存业务事实、版本、账务、任务、幂等记录、Outbox 和审计；Redis 用于验证码/限流缓存、BullMQ 队列和 SSE 任务事件分发。API 在单一数据库事务中写入业务状态、账务预占、GenerationTask 和 Outbox；Publisher 幂等投递 BullMQ，Worker 重放也不会重复生成或结算。

PostgreSQL 始终是任务事实源。Redis 故障时禁止丢失任务：Publisher 后续补投，SSE 降级为 `GET /generation-tasks/{taskId}` 轮询。

### 3. API v1 与固定 envelope

业务 Base URL 固定为 `/api/v1`。成功资源使用 `{ data }`，列表使用 `{ data, meta: { nextCursor, hasMore } }`，错误使用 `{ error: { code, message, requestId, details? } }`。服务端透传或生成 `X-Request-Id` 响应头；字段使用 camelCase、枚举使用 UPPER_SNAKE_CASE、时间使用 RFC 3339 UTC、本地日期使用 `YYYY-MM-DD`。

OpenAPI 3.1 定义所有请求/响应、Security Scheme、枚举、错误、分页和示例。CI 校验实现并运行 breaking-change 检查，前端类型从契约生成。

### 4. 明确的幂等、并发与所有权边界

API 文档列出的命令必须携带 `Idempotency-Key`。相同用户、接口、key 和负载返回第一次结果；不同负载返回 `409 IDEMPOTENCY_KEY_REUSED`。档案 revision、每日指引、赠礼和账务通过数据库唯一键兜底，不能只依赖 Redis 锁。

所有私有资源查询都附带 owner/subject 条件；访问其他用户资源统一返回 404。列表采用不透明 cursor，默认 `createdAt DESC, id DESC`。

### 5. Access Token + Refresh Cookie 与 consent gate

登录 JSON 只返回短期 Access Token；Refresh Token 由 Backend 写入 `HttpOnly + Secure + SameSite=Lax` Cookie，不进入 JSON、URL或日志。刷新接口从 Cookie 读取并轮换，复用时撤销 session family；退出撤销 session 并清除 Cookie。CORS 使用明确来源并允许 credentials，不使用通配来源。

`GET /me` 返回 `requiresConsent`、协议状态、用户类型和 `nextAction`。当需要同意协议时，只允许 `/me`、`POST /me/consents`、协议查询、刷新/退出等白名单接口；其他业务接口返回 `409 CONSENT_REQUIRED`。

### 6. 档案采用 preview → confirm → revisions

`POST /me/life-profile/revisions/preview` 校验并标准化公历/农历、地点、时区、时间精度和真太阳时，创建有期限的 CALCULATED revision，并返回输入 fingerprint、差异提示及四张关系卡牌预览。`POST /me/life-profile/revisions/{revisionId}/confirm` 校验 fingerprint 和状态后原子激活该 revision、将旧 revision 标记为 SUPERSEDED，并保存卡牌/算法/知识版本快照。

`GET /me/life-profile` 返回当前摘要；revision 列表和详情保留历史。新版 R1.0 的他人档案复用 Subject/LifeProfile/Revision 模型，但通过候选 `/me/life-profiles*`、`/me/life-profile-groups*` 契约操作，并强制所有者隔离。

### 7. 智慧种子是 R1.0 唯一对外结算事实

智慧种子账户用账户行锁加不可变流水，在同一事务内更新 available/reserved/累计快照与追加 entry。注册赠礼由 `(user_id, reward_type)` 唯一约束保证恰好一次；最终采用自动到账还是主动领取由候选契约评审冻结。

每日指引创建时预占，成功可交付后核销，失败/取消/超时释放；核销后发现不可交付时追加退款。前端不计算价格或最终余额，响应中的 `SeedSettlement` 来自服务端账务事实。

### 8. 通用 GenerationTask 与 SSE

GenerationTask 对外提供 `GET /generation-tasks/{taskId}`、允许时的 retry 命令和 `/events` SSE。状态和 stage 使用 API v1 既有枚举；SSE 首事件为 snapshot，支持 `Last-Event-ID`、重复事件去重、heartbeat、终态关闭和 Access Token 刷新后重连。SSE 仅驱动 UI，最终状态以 Task/资源查询为准。

R1.0 只有每日指引使用该基础；R1.1 可复用，但不能在本次加入 CardDraw/CardReading 字段。

### 9. 每日指引按本地日期创建和查询

`POST /daily-insights/today` 根据服务端用户生活时区创建或返回当日资源：已 READY 返回 200，首次创建返回 202 和 task。`GET /daily-insights` 返回历史，`GET /daily-insights/{localDate}` 只查询指定日期且不触发生成。

唯一键包含 subject、本地日期、时区和内容策略版本。生成输入固化 Active Profile revision、四张卡牌、算法/知识/工作流/Schema/安全策略版本；不要求 READY 人生报告。Worker 调用 Aqua/生成适配器，完成结构、事实与安全校验后才发布正文并核销种子。

### 10. 安全、隐私和可观测性内建

手机号、验证码、Token、精确出生资料和完整生成输入不得进入日志。敏感列使用应用层信封加密或托管加密；密钥从 secret manager/environment 注入。关键 consent、session、档案确认、账务和注销操作写审计事实。

结构化日志、Trace 与指标通过 requestId、userId、subjectId、taskId、dailyInsightId、Aqua runId 和账务业务键关联。核心监控覆盖认证、consent 拒绝、API 延迟、Outbox/BullMQ 积压、SSE 重连、生成失败、账务悬挂和适配器故障。

## Risks / Trade-offs

- [新版交接与旧架构/API 范围不同] → 以 ADR-0001 为解释规则，OpenAPI 明确标注被覆盖的每日指引前置条件和智慧种子字段。
- [候选档案库/赠礼/种子字段尚未冻结] → 业务编码前完成前后端评审；先写 OpenAPI 和契约测试。
- [Aqua 正式 Workflow Run 契约或知识版本不可用] → 使用端口、Stub 和黄金案例；生产开关在 Staging 契约与内容验收前保持关闭。
- [Redis 故障影响任务和 SSE] → PostgreSQL Outbox/Task 保持事实，补投 BullMQ并降级轮询。
- [并发重试导致重复赠种或扣种] → 数据库唯一业务键、事务锁、幂等记录和对账测试共同防护。
- [多人档案扩大敏感数据范围] → owner/subject 过滤、最小字段、加密、删除影响检查和审计同时上线。

## Migration Plan

1. 依据 ADR-0001 冻结 `/api/v1` OpenAPI 3.1、候选契约、错误码、智慧种子字段和每日指引前置条件。
2. 建立 API/Worker、PostgreSQL、Redis/BullMQ、Outbox、Stub 与运行基线。
3. 按 bootstrap/legal/auth → `/me`/consent → locations/profile preview/confirm → seed ledger/reward → GenerationTask/SSE → home/daily insight → profile library/groups 顺序交付。
4. 最后交付非核心 feedback/注销，执行契约、E2E、安全、故障、账务对账、SSE 和恢复测试。
5. 提供 Staging Base URL、Cookie/CORS/HTTPS、测试账号和故障触发方式，前端逐能力关闭 Mock 并灰度。

回滚时先关闭功能开关和新任务入队，再分别回滚 API/Worker。数据库迁移遵循 expand/contract；流水、revision、consent 和已发布每日指引不得删除，通过补偿流水或状态迁移修复。

## Open Questions

- 注册赠礼采用自动发放还是用户主动领取，需要在候选契约评审中冻结。
- 生产短信、地点和 Aqua 服务地址/鉴权、对象存储及部署平台需要环境负责人确认。
- 赠种数量、每日指引价格、验证码/Session 时限、幂等保留期和历史可见天数需进入可审计配置。
- 注销冷静期、敏感数据保留和备份删除周期需由隐私/法务负责人确认。
