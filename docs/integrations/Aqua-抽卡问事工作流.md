# Aqua 抽卡问事工作流接入说明

**适用版本：** Satori R1.1  
**工作流：** `ai-card-reading`（默认使用 Aqua 当前激活版本）  
**接口：** `POST /api/v1/card-readings/interpretations`

## 1. 接入方式

后端复用项目统一的 `AquaClientFactory`。Base URL 与 Service Key 只从服务端环境读取；
Factory 会按超时策略缓存 SDK Client，抽卡问事与其他使用默认策略的 Workflow 共用同一实例。

抽卡问事只在版本化运行策略中配置工作流 ID：

```ts
aqua: {
  cardReading: {
    workflowId: 'ai-card-reading',
  },
}
```

调用时不传 `workflowVersion`，由 Aqua 选择当前激活版本。单次请求超时显式设为 300 秒，
且 Satori 不在 Workflow Service 内自动重试。

## 2. API 契约

接口受现有 Bearer Token 登录守卫保护，并要求 `Idempotency-Key` 请求头长度为 16–128。
同一业务重试必须复用相同的请求头；后端会把它映射为 Aqua 的
`card-reading:<Idempotency-Key>`，同时作为 `idempotencyKey` 和 `runReference`。

已有卡牌请求：

```http
POST /api/v1/card-readings/interpretations
Authorization: Bearer <access-token>
Idempotency-Key: 018f-card-reading-0001
Content-Type: application/json

{
  "audience": "C",
  "question": "这段关系适合继续吗？",
  "cards": [48, 23, 7],
  "context": {
    "relationship_stage": "了解阶段"
  }
}
```

随机抽牌请求：

```json
{
  "audience": "C",
  "question": "近期最值得关注什么？",
  "random_count": 3
}
```

成功响应沿用全局 API envelope。`mode` 由 Aqua 返回，后端会校验它与牌数一致；其他已通过
Aqua 输出 Schema 的报告字段原样保留：

```json
{
  "data": {
    "mode": "multi"
  }
}
```

## 3. 输入运行时校验

- `question` 去除首尾空白后长度必须为 1–2000；
- `cards` 和 `random_count` 必须且只能提供一个；
- `cards` 必须包含 1–5 个互不重复的整数，每个值为 1–60；
- `random_count` 必须为 1–5 的整数；
- `audience` 只能是 `B` 或 `C`；
- `context` 可选，但只能包含可序列化的 JSON 值；
- 1 张对应 `single`、2 张对应 `dual`、3–5 张对应 `multi`；调用方不能传 `mode`；
- 未声明的顶层字段会被拒绝，包括调用方自行传入的 `workflowVersion`。

校验发生在 Workflow Service 内，Controller 之外的调用也无法绕过。输入错误返回 HTTP 400，
错误码为 `CARD_READING_INPUT_INVALID`，并且不会调用 Aqua。

## 4. 错误映射

| 场景                           | HTTP | 对外行为                                         |
| ------------------------------ | ---: | ------------------------------------------------ |
| Satori 登录缺失或失效          |  401 | 沿用全局认证错误                                 |
| Aqua 401                       |  401 | 保留安全错误码、provider request ID 与 retryable |
| Aqua 403                       |  403 | 保留安全错误码、provider request ID 与 retryable |
| Aqua 429                       |  429 | 不自动重试，由上层业务决定是否复用原幂等键重试   |
| Aqua 超时                      |  504 | `AQUA_CARD_READING_TIMEOUT` 或 SDK 错误码        |
| Aqua 网络、协议或其他 SDK 故障 |  503 | 标准服务不可用响应                               |
| Aqua 输出缺失/错误的 `mode`    |  502 | `AQUA_CARD_READING_RESPONSE_INVALID`             |
| 未知上游异常                   |  503 | `AQUA_CARD_READING_SERVICE_ERROR`                |

错误日志只包含 `kind`、HTTP status、错误码、`requestId`、`executionId`（存在时）和
`retryable`。实现不会记录 Service Key、Client options、认证请求头、请求体或完整用户问题。

## 5. 环境配置

沿用后端已有变量，不新增工作流版本或超时环境变量：

```dotenv
AQUA_BASE_URL=https://aqua.example.com
AQUA_SERVICE_KEY=replace-with-server-secret
```

真实 Service Key 必须通过部署环境的 Secret 管理能力注入，禁止提交到 Git。

## 6. 类型与代码位置

| 文件                                                                                      | 职责                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `backend/packages/modules/src/integrations/aqua/aqua-client.factory.ts`                   | 统一 Client 创建与按策略单例缓存                  |
| `backend/packages/modules/src/integrations/card-reading/card-reading-workflow.types.ts`   | 输入、受众、模式、上下文与结果 TypeScript 类型    |
| `backend/packages/modules/src/integrations/card-reading/card-reading-workflow.service.ts` | 校验、Workflow 调用、结果校验、安全日志与错误映射 |
| `backend/packages/modules/src/card-reading/card-reading.controller.ts`                    | 登录保护的 HTTP 接口与幂等键校验                  |
| `backend/packages/infrastructure/src/config/runtime-policy.ts`                            | 固定工作流 ID                                     |

## 7. 自动化测试范围

单元测试覆盖：已有卡牌成功、随机抽牌成功、全部输入边界、重复牌号、模式不匹配、Aqua
401/403/429、超时、SDK 服务异常、未知异常、禁止自动重试、安全日志以及 Client 单例复用。

这些测试使用模拟 Aqua 响应，只证明代码契约，不代表测试环境已完成真实 Workflow 联调。
