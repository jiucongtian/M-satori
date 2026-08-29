## Why

R1.0 前端界面与发布范围已经冻结，但 `backend/` 尚无可运行服务，且档案库、智慧种子与注册赠礼仍停留在候选契约或 Mock，九项核心功能无法形成可上线闭环。现在需要以现有前端基线、API 支持矩阵和产品架构约束为依据，建设可测试、可追溯且可逐步演进的 R1.0 后端。

## What Changes

- 在 `backend/` 建立 R1.0 模块化单体、API/Worker 独立部署、PostgreSQL、Redis/BullMQ、迁移、配置、统一协议、请求追踪、健康检查与本地开发基线。
- 实现手机号验证码登录/注册、Session 创建/刷新/退出及受保护接口鉴权。
- 实现应用初始化、协议正文、标准地点搜索、当前用户、偏好、必要协议同意、首页聚合、反馈与账号注销申请。
- 实现本人生命智慧档案的草稿恢复、输入版本、四柱计算版本、四张关系卡牌映射及历史可追溯能力。
- 实现多人生命智慧档案库、档案版本和分组的增删改查与所有权隔离。
- 实现智慧种子账户、不可变流水、注册赠礼，以及每日指引生成过程中的预占、核销、释放和退款。
- 实现通用 GenerationTask 查询、SSE 进度、断线恢复和轮询降级，并供每日指引及后续 R1.1 复用。
- 实现每日指引的今日创建、历史/按本地日期查询、幂等生成、异步状态、结果保存、失败恢复及种子结算信息。
- 按 `/api/v1` 冻结并发布 OpenAPI 3.1 契约及 breaking-change 检查，使所有阻塞上线的 `CONTRACT_PROPOSED`/Mock 能替换为真实接口。
- 增加单元、契约、集成与关键路径 E2E 测试，以及结构化日志、指标、审计、限流、备份/恢复与发布回滚说明。

## Capabilities

### New Capabilities

- `r1-api-foundation`: R1.0 服务运行基线、`/api/v1` 通用协议、应用初始化、协议、地点与可观测性。
- `phone-auth-sessions`: 手机验证码挑战、注册/登录、Session 刷新退出、限流与鉴权。
- `self-service-account`: 当前用户、偏好、必要协议同意、首页聚合、反馈及账号注销申请。
- `life-profile-management`: 本人档案草稿、出生资料版本、四柱计算、四张关系卡牌及档案激活。
- `life-profile-library`: 多人档案、版本与分组管理，以及用户级数据隔离。
- `wisdom-seed-ledger`: 智慧种子账户、不可变流水、注册赠礼与消费结算。
- `generation-task-delivery`: 通用生成任务状态、重试、SSE 事件、断线恢复与轮询降级。
- `daily-insight-generation`: 每日指引的幂等生成、异步生命周期、结果查询、失败恢复及种子结算。

### Modified Capabilities

无。当前仓库尚无已发布的 OpenSpec capability；本变更将现有文档和前端候选契约首次固化为可测试规格。

## Impact

- 主要新增代码位于 `backend/`，并新增数据库 schema/migrations、OpenAPI 文档、测试、运行配置和运维说明。
- 前端后续将把 `frontend/src/api/contracts/` 中的候选契约和页面内 Mock 切换为真实 R1.0 API；已冻结的页面结构与视觉不在本变更中调整。
- 文档解释顺序与新版范围覆盖由 `docs/adr/0001-r1-release-source-priority.md` 固化；独立人生报告、旧 `/me/entitlements` 和 R1.1 卡牌业务不进入本变更。
- 接口范围覆盖 `docs/R1.0-api-support-matrix.md` 中所有阻塞上线能力，并遵守 SRS 中模块化单体、版本显式、服务端权限、幂等消费、历史不可静默覆盖和私有数据最小可见原则。
- 外部依赖包括 Redis、短信、地点/时区、Aqua/内容生成服务；均通过可替换适配器接入，并提供本地 fake 与故障降级路径。
