# Aqua PROFILE-11 四卡初识工作流

## 接入基线

- Workflow ID：`profile-four-card-first-look`
- 固定版本：`profile-four-card-first-look/1.0.5`
- Skill 版本：`1.0.0-aqua.2`
- SDK：`@aqua-ai/sdk`
- 认证：仅后端使用 `AQUA_AI_SERVICE_KEY`，不得进入代码、日志或前端包
- 超时：300 秒
- 重试：不自动重试；人工重试复用同一业务报告中持久化的 Aqua `idempotencyKey`

测试环境开关为 `PROFILE_FIRST_LOOK_ENABLED=true`，Aqua 地址和 service key 通过服务器环境变量注入。

## Satori 业务流程

1. 新用户登录后按 `nextAction=CREATE_PROFILE` 进入本人档案创建。
2. H5 调用 preview 和 confirm，后端生成并固化四张关系卡。
3. H5 调用 `POST /api/v1/me/life-profile/revisions/{revisionId}/first-look`。
4. 后端从已确认修订中读取姓名和四卡，调用 Aqua，校验响应后写入 `profile_first_look_reports`。
5. H5 展示持久化的 Aqua 内容；失败或缺失时明示手动重试，不回退 mock/卡牌摘要。
6. `GET /api/v1/me/life-profile/revisions/{revisionId}/first-look` 只读取已持久化的报告。

四卡映射为：`SELF → hour`、`FAMILY → day`、`CAREER → month`、`SPACETIME → year`。Aqua 输出必须严格按 `hour → day → month → year` 排序，对应维度为“思想 → 行为 → 事业 → 梦想目标”。

## 校验与异常

服务端会拒绝以下响应：Schema 不是 `1.0.0`、状态不是 `complete/partial`、四卡数量/顺序/维度/干支不符、notice 不符、Workflow/Skill 版本不符。

- 429：保存 provider requestId，记录 `Retry-After`（如有），不自动重试。
- 401/403：转换为上游授权错误，优先核查租户 Workflow 授权。
- 503/504/超时：保存 requestId、errorCode、retryable 和实际耗时，交由用户手动重试。
- 错误日志只输出脱敏技术字段，不输出输入、密钥、手机号或报告全文。

## 2026-08-18 测试环境验收

- 部署代码：`release/r1.0@4fd3d8b`
- 指定测试账号登录时状态：`NOT_CREATED`，下一步 `CREATE_PROFILE`
- 公网主链路：登录 201、preview 201、confirm 200、Aqua 生成 200、持久化 GET 200
- Aqua 请求耗时：176562 ms
- provider requestId：`cd329d2b-fedc-485e-bd39-2d233fb72938`
- executionId：当前 `@aqua-ai/sdk` 0.1.1 响应未提供，数据库记录为 `null`，不伪造值
- 结果：`READY / complete`，`schemaVersion=1.0.0`，四卡 4 张
- 顺序：`hour → day → month → year`；维度：“思想 → 行为 → 事业 → 梦想目标”
- notice：“这是一份基础认识，不是对你人生的定论。”
- manifest：`profile-four-card-first-look/1.0.5`、`1.0.0-aqua.2`、`deepseek-v4-flash`
- 限流分支：隔离账号曾收到 429 / `EXECUTION_LIMIT_EXCEEDED`，retryable=false、无 `Retry-After`，服务端未自动重试，失败记录已持久化。

