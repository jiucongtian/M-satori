# r1-api-foundation Specification

## Purpose
TBD - created by archiving change implement-r1-backend. Update Purpose after archive.
## Requirements
### Requirement: OpenAPI 3.1 API v1 contract
系统 SHALL 在 `/api/v1` 暴露业务 API，发布可导入的 OpenAPI 3.1 文档，并在 CI 中校验实现漂移和 breaking changes。

#### Scenario: Contract validation runs in CI
- **WHEN** API 实现或 OpenAPI 文档发生变化
- **THEN** CI 校验 method、path、schema、Security Scheme 和兼容性，并阻止未声明的破坏性变更

### Requirement: Common envelope, headers, and formats
系统 SHALL 使用 `{ data }`/`{ data, meta }` 成功 envelope 和 `{ error: { code, message, requestId, details? } }` 错误 envelope，透传或生成 `X-Request-Id`；字段、枚举、时间、本地日期和 cursor MUST 遵守 API v1 约定。

#### Scenario: Business validation fails
- **WHEN** 请求字段组合不合法
- **THEN** 系统返回约定 HTTP 状态和稳定错误码，在响应头及 error 中提供同一个 requestId，且不暴露内部异常

#### Scenario: Cursor list has another page
- **WHEN** 用户请求一个仍有后续数据的列表页
- **THEN** 系统返回 data 数组和包含不透明 nextCursor、hasMore 的 meta

### Requirement: Command idempotency
API 文档指定的命令 SHALL 要求 `Idempotency-Key`；相同用户、接口、key 和负载的重试返回第一次业务结果，不同负载复用 key MUST 返回 `409 IDEMPOTENCY_KEY_REUSED`。

#### Scenario: Identical command is retried
- **WHEN** 同一用户以相同 key 和负载重试档案确认或每日指引创建
- **THEN** 系统返回第一次操作结果且不重复创建资源、任务或账务流水

### Requirement: Application bootstrap and legal documents
系统 SHALL 通过 `GET /api/v1/app/bootstrap` 返回服务时间、客户端版本策略、维护状态、当前必要协议和公共功能开关，并通过 `GET /api/v1/legal-documents/{documentId}` 返回指定已发布协议正文及版本。

#### Scenario: Client starts R1.0
- **WHEN** H5 请求 bootstrap
- **THEN** 系统只返回 R1.0 已开放能力、当前协议标识/版本和安全的公共配置

#### Scenario: Legal document is unavailable
- **WHEN** 客户端请求不存在或未发布的协议
- **THEN** 系统返回 not-found 且不泄露草稿内容

### Requirement: Standard location search
系统 SHALL 通过 `GET /api/v1/locations` 返回标准地点标识、层级名称、IANA 时区和可用地理元数据，并限制 query 与结果数量。

#### Scenario: User searches a city alias
- **WHEN** 用户输入有效城市名或别名
- **THEN** 系统返回标准化地点候选及稳定 locationId，供档案 preview 固化解析快照

### Requirement: Operational readiness
系统 SHALL 提供 liveness/readiness、结构化脱敏日志、Trace 和核心指标；PostgreSQL、Redis 或关键适配器不可用时 MUST 反映真实依赖状态或明确降级。

#### Scenario: PostgreSQL is unavailable
- **WHEN** readiness 无法访问业务事实库
- **THEN** 系统标记为未就绪且日志不输出凭据或敏感业务数据

#### Scenario: Redis is temporarily unavailable
- **WHEN** PostgreSQL 可用但 Redis 队列/事件不可用
- **THEN** 系统保留已提交 Outbox/Task，标记异步能力降级并允许后续补投
