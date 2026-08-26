# Aqua 首页每日能量摘要集成说明

**适用版本：** Satori R1.0

**事实核验日期：** 2026-08-26

**当前状态：** 共享组合预热已部署并完成测试环境验收；未来三天均为 60/60，全新账号首次有效首页请求 19 毫秒返回共享 `READY` 且未新增用户级缓存

## 1. 范围与边界

首页摘要与付费的“每日完整指引”是两个独立能力：

- 首页摘要由 `daily-energy-home-summary/1.0.3` 生成，随 `GET /api/v1/me/home-overview` 返回，不扣智慧种子；
- 完整每日指引继续使用 `/daily-insights*`、异步任务和智慧种子结算，不复用首页摘要结果；
- H5 不接触 Aqua 地址、service key、幂等键或供应方 request ID。

## 2. 请求契约

后端使用 `@aqua-ai/sdk@0.1.1` 的无状态工作流方法：

```ts
await aqua.workflows.run("daily-energy-home-summary", {
  workflowVersion: "daily-energy-home-summary/1.0.3",
  idempotencyKey: `daily-energy-${date}-shared-${cycleIndex}`,
  runReference: `shared-${cycleIndex}`,
  input: {
    day_card: dayCard,
    heaven_card: heavenCard,
    date,
  },
});
```

输入来源：

- `name`：共享预热时不发送，避免把某位用户姓名写入所有用户共用的缓存；读取缓存后由 Satori 在内存中补上当前用户称呼；
- `day_card`：当前本人档案 `FAMILY` 维度卡牌的 `snapshotPillar`；该字段来自档案创建时 `localCalculateBazi/v1.3` 计算出的出生八字日柱；
- `heaven_card`：Satori 将用户时区当天公历日期传入 `localCalculateBazi/v1.3`，取其日柱；业务层不得另行调用第三方日干支算法；
- `date`：用户时区的当天日期，格式 `YYYY-MM-DD`。

调用前会校验日期、六十甲子、幂等键和运行引用格式。Aqua 返回的 `day_card`、`heaven_card` 必须与请求一致，否则拒绝缓存和展示。

## 3. 响应、缓存与前端

Satori 从 Aqua `result` 严格读取并映射：

`greeting`、`guidance`、`energy_level`、`suitable_actions`、`cautions`、`date`、`day_card`、`heaven_card`、`score`、`signals`、`rule_version`、`copy_version`。

同一天的 `heaven_card` 固定，用户 `day_card` 只有六十甲子 60 种，因此 Worker 为每个目标日期预生成 60 个组合。校验成功后写入共享表 `daily_energy_home_summary_cache`，唯一键为日期、日卡和工作流版本。默认覆盖各活跃用户时区的今天及未来两天；时区落在不同自然日时自动取日期并集。

`home-overview` 只按用户当天日期和日卡读取共享缓存，不在请求链路调用 Aqua；命中后在内存中补上当前用户称呼并返回 `dailyEnergySummary.state=READY`。预热尚未完成或 Aqua 失败时立即返回 `UNAVAILABLE`，前端不等待 LLM，也不展示写死建议。旧的 `daily_energy_home_summaries` 仅用于平滑兼容已经生成的用户级缓存；系统不再提供关闭预热后按用户即时生成的环境分支。

## 4. 配置与安全

| 环境变量           | 规则                                                      |
| ------------------ | --------------------------------------------------------- |
| `AQUA_BASE_URL`    | 所有环境必填；与完整每日指引共用同一租户地址              |
| `AQUA_SERVICE_KEY` | 所有环境必填，至少 20 字符；可调用该租户下的全部 Workflow |

Workflow ID/版本、15 秒请求超时、最多 2 次尝试、250 毫秒退避，以及“3 天、并发 3、5 秒间隔、每小时运行”的预热规则统一保存在 `runtime-policy.ts`。它们是业务运行基线，不允许测试和生产通过环境变量形成不同逻辑。Worker 始终负责预热，API 始终只读共享缓存。

service key 不进入前端构建、OpenAPI、数据库业务内容或普通日志。

## 5. 错误与重试

- 非 2xx/SDK 错误记录 `errorCode`、`message`、`requestId`、`retryable` 和尝试次数，不记录请求头或密钥；
- 仅 `retryable=true` 时重试，其他错误第一次失败后立即停止；
- 响应 Schema、卡牌事实或本地输入不合法均不可重试；
- 最终失败不会使整个首页接口失败，但首页摘要状态为 `UNAVAILABLE`。

## 6. 验收清单

- [x] SDK 请求体、固定工作流版本和幂等键单元测试；
- [x] 全部结果字段映射和卡牌事实一致性测试；
- [x] 可重试与不可重试错误分支测试；
- [x] OpenAPI、前端类型和动态渲染接入；
- [x] 按日持久缓存与数据库迁移；
- [x] 测试环境部署、真实账号输入构造、安全降级和脱敏错误日志；
- [x] 测试环境真实 Aqua 成功响应；
- [x] 同日重复打开只命中同一幂等运行/缓存；
- [x] 60 种日卡共享组合、匿名请求、时区日期并集和并发预热单元测试；
- [x] 测试环境未来三天共 180 个组合预热完成且最终补洞失败数为 0；
- [x] 新账号首次打开首页只读共享缓存，不产生同步 Aqua 调用；
- [ ] 401、429、5xx、超时和非法响应的测试环境验证；
- [ ] 首页公网 UI 与服务端日志脱敏验收。

2026-08-17 测试环境验收记录：`release/r1.0@a2e8102` 已部署至 `test-satori.shenxinyou.com`，迁移、API 健康检查、静态前端和真实账号首页请求均已执行。首次请求曾因 Aqua 租户授权返回非重试错误 `WORKFLOW_SCOPE_DENIED`，Satori 正确降级为 `UNAVAILABLE`；授权完成后复验返回 `READY`，问候、指引、能量等级、适合事项、注意事项及规则/文案版本均完整。隔离账号连续请求两次的响应完全一致，最近五分钟数据库仅新增一条 `daily_energy_home_summaries` 记录，证明同日第二次请求复用了缓存。公网首页和 bootstrap 均返回 HTTP 200。

2026-08-17 共享预热验收记录：后端 `ba9b51d` 已部署，迁移 `0006_known_ultimates.sql` 成功。Aqua 工作流限制确认为每分钟 30 次；Satori 使用 Redis 全局 5 秒发车间隔，按最多一次重试计算最坏约 24 次/分钟。Aqua 内部 LLM 配置修复后缓存恢复增长；隔离新账号确认档案后的首次首页请求 19 毫秒返回 `READY`，第二次响应一致，字段完整，`daily_energy_home_summaries` 新增数为 0，证明请求链路只读共享缓存且没有同步调用 Aqua。2026-08-26 起测试与生产统一采用版本化的 15 秒超时和 250 毫秒退避，不再允许服务器单独覆盖。

最终缓存验收：`2026-08-17`、`2026-08-18`、`2026-08-19` 均为 60 条，共 180 条。Aqua 内部执行截止的少数组合通过后续补洞轮次恢复；最终一轮报告为 `requested=180`、`generated=1`、`cached=179`、`locked=0`、`failed=0`。
