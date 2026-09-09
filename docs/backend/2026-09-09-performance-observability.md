# 性能与并发瓶颈日志

状态：已实现代码；本批未切换测试站点或生产。采集面覆盖 API、数据库、generation/commerce 队列、Aqua Workflow 与 SSE；不增加业务表或迁移。

## 日志与关联

新增记录为 stdout 单行 JSON，公共字段：`timestamp`（UTC）、`service`、`role`、`environment`、`release`、`instance`、`pid`、`event`、`level`。

- HTTP 的 UUID `requestId`/`traceId` 保存在异步上下文中，并通过 `X-Request-Id` 返回。
- 商业接口保留响应中的业务关联 ID，统一由 HTTP 完成日志记录；取消原先可能记录错误状态码的商业拦截器日志。
- Outbox 已有的商业 `request_id` 被带入 Job 的 `_telemetry`，生成任务现在也持久化请求 ID。Outbox ID 与 Job ID 一致；Worker 恢复上下文后，数据库与 Aqua 日志带同一请求/任务关联。
- 历史事件若没有请求 ID，以 Outbox/Job ID 作为 traceId；不会伪造历史 HTTP 关联。后台任务可通过 taskId/orderId 联查。旧队列转投保留 `_telemetry`。
- Aqua 每次工作流有独立 `callId`/`providerRequestId`；HTTP 请求 ID 与供应商请求 ID 分开。当前 SDK Workflow 不自动重试，业务重试由队列执行；记录实际 attempt/retry，未改变重试策略。
- SQL 只记录语句 SHA-256 前 16 位 `queryHash`，不输出 SQL 正文、绑定参数或用户数据。错误仅记录类型、错误码等安全字段，不复制错误消息和响应正文。
- 请求路径使用路由模板，不记录 URL 查询串、Cookie、授权头或请求体。任务/订单/请求 ID 仅用于日志，不能放入指标标签。已有其他业务日志未做全仓格式迁移。

## 采集内容与口径

| 事件 / 指标 | 用途及边界 |
| --- | --- |
| `http_request_completed` / `http_request_ms` | 最终状态、模板路由、方法和请求总耗时；异常过滤器和鉴权失败同样统计。连接提前关闭记 499。 |
| `http_stream_lifetime_ms` | SSE HTTP 连接寿命，与普通 API 延迟分开，避免把长连接误判为慢接口。 |
| `db_acquire_ms` | 从申请连接到获得连接，包含新建连接及连接池等待；超过 100 ms 或失败输出明细。 |
| `db_query_ms` | 已取得连接后调用 query 到完成，包含驱动/网络/服务器执行与锁等待；超过 250 ms 或失败输出带 queryHash 的明细。支持普通 Promise、回调和 Drizzle；自定义流式 Query 对象保持原行为，不纳入该计时。 |
| `runtime_snapshot` | 每 15 秒：CPU 核数占用、RSS/堆、事件循环 P95/最大延迟、连接池总数/空闲/等待数、HTTP/SSE/两个消费者/Aqua 活跃数。瞬时快照可能漏掉短峰值，需结合全量耗时直方图。 |
| `db_activity_snapshot` | 当前数据库可见会话的活跃数、锁等待数、idle-in-transaction 数及最老执行/事务年龄。每个 API/Worker 最多增加 1 条独立诊断连接，连接与语句超时 1 秒、客户端查询超时 2 秒；不抢业务池。可见性取决于数据库账号权限。 |
| `queue_snapshot` | 每 15 秒采集 generation/commerce 各自等待、执行、延时、失败、优先任务数、消费者连接数、暂停状态、最老普通等待任务年龄。不是每个任务的排队时长；重试任务年龄包含此前执行/退避。 |
| `queue_first_attempt_wait_ms` | 第一次领取时，创建 Job 到开始执行，扣除显式初始 delay；重试不会把累计年龄误记为纯排队时间。 |
| `queue_execution_ms` / `queue_completion_age_ms` | 每次处理器执行时长、处理成功时距 Job 创建的累计年龄。成功指处理器返回，不等同于业务最终成功；可能是幂等跳过、legacy 转投或业务处理器自行转入重试状态，需要结合业务状态。 |
| `queue_job_started/completed/failed/stalled` | 任务类别、attempt、关联 ID、执行耗时和失败码；`attemptsExhausted` 是队列尝试预算判断。Worker 连接错误另有事件。 |
| `outbox_published` / `outbox_publish_age_ms` | Outbox 创建到投递的年龄；投递失败、批次读取失败另有日志和计数。 |
| `aqua_workflow_ms` | 完整 SDK 调用（含响应正文解析、实际重试/退避）的耗时与结果；不等同模型服务端纯推理时间。 |
| `aqua_http_attempt` / `aqua_http_headers_ms` | 每次实际 HTTP 尝试的状态与收到响应头耗时，用于识别 429、5xx。网络失败及超时在 attempt/workflow 失败日志中记录。 |
| `sse_stream_opened/closed/failed` | 流生命周期、终止原因、发送事件数。活跃流在关闭时只扣减一次。 |
| `sse_redis_degraded/subscribed` | 连接/订阅异常、重连恢复；同一连接故障明细最多每 30 秒一条，但计数不采样。 |
| `sse_reconcile_requested` | 区分 initial、notification、commit_recheck、fallback；fallback 每 15 秒本来就会发生，非零不直接代表 Redis 故障。 |
| `sse_event_age_at_emit_ms` / `sse_notification_reconcile_ms` | 事件创建到服务端发出的年龄（区分 replay/live），及通知到补读完成的时长。未包含客户端网络接收/渲染；回放年龄不能当实时推送延迟。 |

## 聚合、容量和留存

- `metric_window` 每 15 秒输出每个标签组合的增量 `count/sum/max/buckets`；各桶互斥，上界见 `boundsMs`，最后一桶为正无穷。跨时间/实例先合并桶，再求 P95/P99，不能平均各实例百分位。
- 耗时分布全量计数，没有对正常请求采样；不是每条 SQL 都打印。每窗口最多 2048 个标签组合，溢出有 `metric_series_overflow`。当前固定阈值便于先收集基线，再调整桶精度。
- stdout 待写缓冲超过 1 MiB 时丢弃观测日志，避免持续堆积；后续成功记录带 `droppedLogs`。这不保证进程崩溃前的窗口、日志驱动或外部采集器没有丢失。
- Redis 采样不重叠；长时间卡住时 `queueSnapshotPendingMs` 增长，不能把缺少快照解释成队列正常。API ready 探针仍不是商业消费者健康保证，应看两个队列快照。
- 测试 Compose 为 API/Worker 设置每文件 20 MiB、保留 5 文件；这是空间上限，不保证保留天数。Nginx 继续使用主机已有日志轮转配置，部署时核对其保留周期。
- 本批提供可持续采集的日志与离线汇总，未安装集中式存储、看板或告警。正式压测和线上长期趋势分析前，应接入既有日志平台并按容量设置留存（例如 30 天），核验丢失计数。单靠容器轮转不能保证长期历史完整。

## 部署与验证

测试 Compose 构建前传入完整 `RELEASE_SHA`（例如 `export RELEASE_SHA=$(git rev-parse HEAD)`）；Docker runtime 镜像保存版本标签。`APP_ENV=test` 由测试 Compose 提供；其他环境需设置实际值。未提供版本会显示 `release=unknown`，不得据此宣称版本已对齐。

Nginx 的站点配置增加 `satori_performance` JSON 格式：请求总耗时、上游建连/响应头/响应耗时、状态、字节数。格式在 http 上下文声明；先 `nginx -t` 再 reload。使用后端响应的 `X-Request-Id` 关联 API，Nginx 自身另有 gatewayRequestId；未转发到上游的请求没有 API 请求 ID。时间字段为秒，可能是 `-` 或多次上游尝试的列表。

导出同一时间段的 API/Worker 日志（避免重复时间片）后，在 backend 目录运行：

```bash
node scripts/summarize-performance.mjs < performance.jsonl
```

支持应用 JSON 行和 Docker json-file 外壳，忽略既有普通文本；输出按路由/状态/队列分组的均值、最大值、P95/P99 桶上界和资源峰值。精确单次耗时应追查关联日志。不得把多个重叠导出重复计数。

排查顺序：API P95 升高 → 看连接池 waiting/acquire → 看 SQL queryHash/锁等待/CPU；生成变慢 → 看 Outbox age → queue 首次等待/执行 → Aqua 完整调用 → SSE live event age。支付慢应单独看 commerce，不与 generation 混合计算。

## 本批验证结果

- 本地：类型检查、定向 ESLint、后端构建通过；41 项定向单元、28 项契约通过。覆盖 HTTP 最终错误码与并发上下文、pg 回调/Promise 保持、直方图聚合、标签上限、日志故障不影响调用、队列重试口径、Aqua 429/网络失败/超时、SSE 关联隔离与故障日志限频。
- 测试服务器独立 PostgreSQL/Redis：30 项集成通过（新增数据库观测 2、任务投递与隔离 6、问事生命周期 7、订单支付 10、消费编排 5）；11 项 auth-flow E2E 通过。初次 E2E 因独立库缺协议基础数据失败，执行正式 seed 脚本后通过，未为此修改业务逻辑。
- 独立运行采样通过：两个真实消费者各 1 个，输出 `runtime_snapshot`、`db_activity_snapshot`、两类 `queue_snapshot` 和 `metric_window`；离线工具成功汇总实际日志。该短时验证不代表压测容量结论。
- 测试 Compose 解析和服务器上的候选 `nginx -t` 均通过，未 reload。隔离契约最终 28 项通过；首次候选包漏带 Compose 且带入 macOS 元数据文件，补齐/清理测试包后通过。
- 隔离证据目录：测试服务器 `/opt/satori-test/integration/observability-20260909`；本轮没有使用站点业务数据库、真实 AI 或支付供应商。
