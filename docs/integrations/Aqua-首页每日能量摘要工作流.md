# Aqua 首页每日能量摘要集成说明

**适用版本：** Satori R1.0

**事实核验日期：** 2026-08-17

**当前状态：** 代码与自动化测试已完成，测试环境真实工作流待部署验收

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
  idempotencyKey: `daily-energy-${date}-${userId}`,
  runReference: userId,
  input: {
    name: userName,
    day_card: dayCard,
    heaven_card: heavenCard,
    date,
  },
});
```

输入来源：

- `name`：本人档案称呼，服务端裁剪空白，最大 64 字符；
- `day_card`：当前本人档案 `FAMILY` 维度卡牌的 `snapshotPillar`；
- `heaven_card`：Satori 根据用户时区当天公历日期计算的日柱；
- `date`：用户时区的当天日期，格式 `YYYY-MM-DD`。

调用前会校验日期、六十甲子、幂等键和运行引用格式。Aqua 返回的 `day_card`、`heaven_card` 必须与请求一致，否则拒绝缓存和展示。

## 3. 响应、缓存与前端

Satori 从 Aqua `result` 严格读取并映射：

`greeting`、`guidance`、`energy_level`、`suitable_actions`、`cautions`、`date`、`day_card`、`heaven_card`、`score`、`signals`、`rule_version`、`copy_version`。

校验成功后写入 `daily_energy_home_summaries`，唯一键为用户、日期和工作流版本。同一天重复打开首页优先读取缓存，不重复发起供应方调用。`home-overview` 对外返回 `dailyEnergySummary.state` 与 `data`；未配置、输入缺失或 Aqua 失败时返回不可用状态，前端不展示写死的能量等级或建议。

## 4. 配置与安全

| 环境变量 | 规则 |
| --- | --- |
| `HOME_ENERGY_SUMMARY_ENABLED` | 默认 `false`；测试/生产启用时设为 `true` |
| `AQUA_BASE_URL` | 启用时必填，合法 URL |
| `AQUA_TENANT_SERVICE_KEY` | 启用时必填，至少 20 字符，只能注入服务端 |
| `HOME_ENERGY_SUMMARY_TIMEOUT_MS` | 默认 15 秒 |
| `HOME_ENERGY_SUMMARY_MAX_ATTEMPTS` | 默认 2，最大 3 |
| `HOME_ENERGY_SUMMARY_RETRY_BACKOFF_MS` | 默认 250 毫秒 |

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
- [ ] 测试环境真实 Aqua 成功响应；
- [ ] 同日重复打开只命中同一幂等运行/缓存；
- [ ] 401、429、5xx、超时和非法响应的测试环境验证；
- [ ] 首页公网 UI 与服务端日志脱敏验收。
