# generation-task-delivery Specification

## Purpose
TBD - created by archiving change implement-r1-backend. Update Purpose after archive.
## Requirements
### Requirement: Persistent generation task query
系统 SHALL 通过 `GET /api/v1/generation-tasks/{taskId}` 仅向任务所有者返回持久状态、产品化 stage、目标资源、可重试标志和安全失败信息；Redis/SSE 不得成为任务事实源。

#### Scenario: Owner queries a running task
- **WHEN** 用户查询自己的 DailyInsight GenerationTask
- **THEN** 系统返回 PostgreSQL 中的当前完整状态和 stage，不返回 Aqua run、Prompt、模型或成本细节

#### Scenario: Another user queries the task
- **WHEN** 非所有者请求 taskId
- **THEN** 系统返回 404 且不泄露任务或目标资源存在性

### Requirement: Idempotent task retry
系统 SHALL 通过要求 `Idempotency-Key` 的 `POST /api/v1/generation-tasks/{taskId}/retry` 仅重试 `canRetry=true` 的失败任务，沿用原目标资源并创建新 attempt，不重复预占或核销种子。

#### Scenario: Retryable task is retried
- **WHEN** 所有者重试可重试失败任务
- **THEN** 系统返回 202、创建一个新 attempt 并保持原 DailyInsight 与正确 settlement

#### Scenario: Running task is retried
- **WHEN** 任务已经运行或达到重试上限
- **THEN** 系统返回对应稳定冲突错误且不投递新 job

### Requirement: Authorized SSE task events
系统 SHALL 通过 `GET /api/v1/generation-tasks/{taskId}/events` 提供经 Bearer Auth 授权的 `text/event-stream`，支持 snapshot、stage_changed、retry_waiting、ready、failed、heartbeat、Last-Event-ID 和终态关闭。

#### Scenario: Client connects to task events
- **WHEN** 所有者以 fetch-based SSE 建立连接
- **THEN** 服务端首先发送完整 snapshot，随后发送可重复去重的阶段事件和 heartbeat

#### Scenario: Client reconnects after interruption
- **WHEN** 客户端携带 Last-Event-ID 重连
- **THEN** 系统在保留窗口内补发事件或发送最新 snapshot，后台任务不因断线取消

### Requirement: Polling fallback
系统 SHALL 在 SSE 或 Redis 事件暂不可用时允许客户端退避轮询 Task/目标资源，并保证轮询和 SSE 观察到同一终态。

#### Scenario: SSE is unavailable
- **WHEN** Redis 事件分发或网络连接失败但任务事实仍可读
- **THEN** 客户端可通过 Task 查询恢复状态，任务继续执行且结算不受影响
