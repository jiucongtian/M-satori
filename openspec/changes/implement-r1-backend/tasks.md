## 1. 契约冻结与 ADR 落地

- [x] 1.1 以 ADR-0001 为范围基线，逐行核对 R1.0 交接矩阵、API v1 文档和八份 capability spec，建立接口状态/负责人清单
- [x] 1.2 与前端冻结注册赠礼自动发放或主动领取策略，以及 `/me/registration-reward*` 精确 method/path/schema
- [x] 1.3 与前端冻结档案库、档案分组、智慧种子账户/流水的候选 method/path/schema、错误码和分页语义
- [x] 1.4 冻结每日指引智慧种子价格、结算字段，并从 API v1 契约移除 `LIFE_REPORT_REQUIRED` 前置条件
- [x] 1.5 冻结 consent 文档版本、验证码/Session 时限、幂等保留期、限流阈值和历史可见天数等可配置规则
- [x] 1.6 编写完整 `/api/v1` OpenAPI 3.1，包含成功/错误 envelope、Bearer/Refresh Cookie Security Scheme、SSE、枚举、示例和所有 R1.0 路由
- [x] 1.7 从 OpenAPI 生成前端类型，并在 CI 增加 schema 校验、实现漂移和 breaking-change 检查

## 2. 工程、数据与部署基线

- [x] 2.1 在 `backend/` 初始化 Node.js 22、TypeScript、NestJS/Fastify workspace，建立 `apps/api`、`apps/worker` 和共享 packages
- [x] 2.2 建立 identity/profile/astrology/profile-library/seed-ledger/generation-task/daily-insight/feedback/operations/integrations 模块及依赖边界测试
- [x] 2.3 配置 lint、format、typecheck、unit、integration、contract、e2e 和 coverage 脚本
- [x] 2.4 配置 PostgreSQL、Drizzle schema/migrations、事务工具、UUIDv7、UTC 和 expand/contract 迁移约定
- [x] 2.5 配置 Redis/BullMQ、API/Worker 队列连接、重试/超时/并发、优雅停机和健康检查
- [x] 2.6 提供 Docker Compose PostgreSQL/Redis、`.env.example`、配置 schema 和一条命令启动/迁移/测试说明
- [x] 2.7 创建 users/identities/sessions/sms_challenges/consent_records/preferences/idempotency_records/audit_logs 表及约束
- [x] 2.8 创建 subjects/life_profiles/revisions/location_snapshots/astrology_snapshots/card_bindings/groups 表及约束
- [x] 2.9 创建 seed_accounts/seed_entries/registration_rewards/daily_insights/generation_tasks/attempts/outbox/events/feedback/deletion_requests 表及约束

## 3. 通用 API、初始化与地点

- [x] 3.1 实现 `/api/v1` 路由前缀、请求校验、`X-Request-Id`、成功/错误 envelope 和 API v1 HTTP 状态映射
- [x] 3.2 实现不透明 cursor 分页、命令 `Idempotency-Key` 存储/重放/冲突检测和保留清理任务
- [x] 3.3 实现 bootstrap 配置版本、Feature Flag 和 `GET /api/v1/app/bootstrap`
- [x] 3.4 实现 legal document 发布数据、seed/migration 和 `GET /api/v1/legal-documents/{documentId}`
- [x] 3.5 定义 `LocationProvider` 并提供确定性本地适配器及生产适配器端口
- [x] 3.6 实现带 query/limit 约束的 `GET /api/v1/locations` 和标准地点/时区返回
- [x] 3.7 添加 envelope、requestId、幂等、bootstrap、协议和地点 API 契约/集成测试

## 4. 手机认证、Session 与 Consent

- [x] 4.1 定义 `SmsGateway`、开发固定验证码和生产短信适配器配置/超时/错误归一化
- [x] 4.2 实现验证码摘要、过期、尝试次数、一次性消费及手机号/IP/设备限流
- [x] 4.3 实现 `POST /api/v1/auth/sms-challenges` 及幂等、限流响应头、Retry-After 和供应商失败测试
- [x] 4.4 实现 `POST /api/v1/auth/sessions`，在事务中完成新用户/老用户分流、Session、种子账户和赠礼资格初始化
- [x] 4.5 实现短期 Access Token、不落 JSON 的 Refresh Token hash、`HttpOnly + Secure + SameSite=Lax` Cookie 和明确 credentialed CORS
- [x] 4.6 实现 `POST /api/v1/auth/sessions/refresh` 的 Cookie 轮换/复用检测和 `DELETE /api/v1/auth/sessions/current` 的撤销/清 Cookie
- [x] 4.7 实现 `GET /api/v1/me` 的 requiresConsent、协议状态、档案状态和稳定 nextAction
- [x] 4.8 实现 `POST /api/v1/me/consents` 的版本校验、幂等证据保存及 consent gate 白名单
- [x] 4.9 实现 `PATCH /api/v1/me/preferences` 的 locale/生活时区更新与规范化响应
- [x] 4.10 添加账号防枚举、并发注册、Refresh Cookie 泄露/重放、CORS、consent gate 和老用户直达首页状态测试

## 5. 本人生命智慧档案与四张卡牌

- [x] 5.1 实现 `GET /api/v1/me/life-profile`、revision 游标列表和 revision 详情的所有者查询
- [x] 5.2 实现公历/农历、时间精度、传统时辰、locationId 和字段组合校验
- [x] 5.3 定义 `BirthChartCalculator`，保留地点/时区快照和算法版本，将四柱内核升级为 `localCalculateBazi_v1_3`（按输入民用时间计算，不使用城市真太阳时；含分钟级节气、整时辰边界规则和黄金案例）
- [x] 5.4 实现 `POST /api/v1/me/life-profile/revisions/preview` 的同步预计算、有期限 CALCULATED revision、fingerprint 和幂等重放
- [x] 5.5 实现年/月/日/时到时空/事业/家庭/自我四张卡的固定映射及卡牌/知识/规则版本快照
- [x] 5.6 实现 `POST /api/v1/me/life-profile/revisions/{revisionId}/confirm` 的 fingerprint、期限、状态校验和原子 Active/Superseded 切换
- [x] 5.7 保证新 revision 激活后旧 DailyInsight/内容仍绑定原 profile/card revision
- [x] 5.8 添加日期边界、农历、未知时间、真太阳时增强确认、重复 preview/confirm、过期/fingerprint 和卡牌顺序测试

## 6. 智慧种子账务与注册赠礼

- [x] 6.1 实现种子账户 repository、账户行锁、不可变流水及 available/reserved/累计快照原子更新
- [x] 6.2 实现 `GET /api/v1/me/wisdom-seed-account` 和游标分页 `GET /api/v1/me/wisdom-seed-transactions`
- [x] 6.3 按冻结契约实现注册赠礼资格查询及自动发放或主动领取，使用 `(userId, rewardType)` 唯一键保证恰好一次 `GRANT`
- [x] 6.4 实现按唯一业务键的 RESERVE、CONSUME、RELEASE、REFUND 和 ADJUSTMENT 应用服务
- [x] 6.5 实现关联 businessType/resourceId/originalEntryId 的流水 DTO 和 `SeedSettlement`
- [x] 6.6 实现账户快照、reserved 与流水求和的对账命令、指标和异常告警
- [x] 6.7 添加并发赠礼、并发预占、余额不足、重复核销/释放、补偿退款和负余额不变量测试

## 7. Outbox、GenerationTask 与 SSE

- [x] 7.1 实现业务事务内 GenerationTask/Outbox 写入和幂等 Outbox Publisher → BullMQ 投递
- [x] 7.2 实现 Worker 领取、attempt、heartbeat、超时、指数退避、死信、崩溃恢复和结果幂等
- [x] 7.3 实现 `GET /api/v1/generation-tasks/{taskId}` 的所有者隔离、状态/stage/target/canRetry/failure DTO
- [x] 7.4 实现 `POST /api/v1/generation-tasks/{taskId}/retry` 的状态校验、新 attempt 和不重复种子结算
- [x] 7.5 实现 `GET /api/v1/generation-tasks/{taskId}/events` 的 fetch-based Bearer SSE、snapshot、stage、retry、ready、failed 和 heartbeat
- [x] 7.6 实现 SSE `Last-Event-ID` 补发/最新快照、重复事件去重语义、终态关闭和 Access Token 刷新后重连支持
- [x] 7.7 实现 Redis/SSE 不可用时基于 PostgreSQL Task 的退避轮询降级和 Outbox 补投
- [x] 7.8 添加 Outbox 重复投递、Worker 崩溃、Redis 故障、SSE 断线重连、跨用户访问和重试上限测试

## 8. 每日指引与首页闭环

- [x] 8.1 定义 Aqua/`DailyInsightGenerator`、输出 Schema、GenerationManifest、事实/结构/安全校验及确定性 Stub
- [x] 8.2 实现按 subject/localDate/timezone/contentPolicyVersion 唯一的 DailyInsight 聚合
- [x] 8.3 实现 `POST /api/v1/daily-insights/today` 的 200/202 语义，在事务中创建资源、Task、种子预占和 Outbox
- [x] 8.4 确保每日指引只要求 consent、生活时区、Active Profile/四张卡和足够种子，不要求 READY 人生报告
- [x] 8.5 实现 Worker 调用 Aqua/Stub、固化全部版本、校验发布、GenerationManifest 和成功 CONSUME
- [x] 8.6 实现临时失败自动重试、永久失败 RELEASE、核销后不可交付 REFUND 和安全人工 retry
- [x] 8.7 实现 `GET /api/v1/daily-insights/{localDate}` 的查询-only 状态/正文/task/fallback/SeedSettlement
- [x] 8.8 实现游标分页 `GET /api/v1/daily-insights` 历史列表和配置化可见天数
- [x] 8.9 实现 `GET /api/v1/me/home-overview` 的档案/cards、赠礼、种子余额、今日状态和 nextAction 聚合
- [x] 8.10 添加本地跨日、多设备并发、重复 today、余额不足、半成品不可见、任务重放、最多核销一次和历史稳定性测试

## 9. 生命智慧档案库与分组

- [x] 9.1 按冻结契约实现 `/api/v1/me/life-profiles*` 游标列表、SELF/OTHER 创建和一个 SELF 约束
- [x] 9.2 为他人档案复用 preview/confirm revision、四张卡牌和版本历史能力
- [x] 9.3 实现档案元数据更新、owner/subject 查询隔离和跨用户统一 404
- [x] 9.4 实现档案删除影响检查、活动任务阻塞、逻辑删除和异步清理
- [x] 9.5 按冻结契约实现 `/api/v1/me/life-profile-groups*` 创建、重命名、排序和删除
- [x] 9.6 实现档案加入/移出分组及删除分组时原子清空关联但保留档案
- [x] 9.7 添加第二 SELF、跨用户枚举、他人档案 revision、分组事务、删除影响和历史引用测试

## 10. 非核心反馈与账号注销

- [x] 10.1 实现 `POST /api/v1/feedback` 的 LIFE_REPORT/DAILY_INSIGHT 目标校验、rating/reason、文本安全和幂等历史保存
- [x] 10.2 实现 DELETE_ACCOUNT SMS challenge 和 `POST /api/v1/me/account-deletion-requests` 的重新认证、影响快照及 202 状态
- [x] 10.3 实现 `GET /api/v1/me/account-deletion-request` 和 `DELETE /api/v1/me/account-deletion-request` 的查询/可撤回状态机
- [x] 10.4 实现注销后的 Session 撤销、数据处理任务、账务/审计保留和删除传播
- [x] 10.5 添加反馈越权、注销重复提交、验证码失败、不可撤回状态和删除恢复测试

## 11. 联调、质量与发布门禁

- [x] 11.1 为交接矩阵每一行建立自动契约测试和状态报告，将已完成接口推进到 INTEGRATED/VERIFIED
- [x] 11.2 完成注册、consent、档案 preview/confirm、四张卡、赠种、每日指引和次日回访首页 E2E 及主要异常路径
- [x] 11.3 完成本人/他人档案库与分组 E2E，并验证所有私有资源 owner 隔离
- [x] 11.4 执行核心模块不低于 80% 覆盖率门禁及 OpenAPI/SSE/生成 Schema/Aqua Stub 契约测试
- [x] 11.5 执行账号枚举、验证码滥用、Cookie/CORS、越权、幂等重放、敏感日志、删除传播和账务并发安全测试
- [x] 11.6 执行认证/首页 P95、BullMQ 积压、SSE 连接和并发种子结算压测，冻结 R1.0 SLO/告警
- [x] 11.7 编写数据库/Redis恢复、Outbox补投、死信、SSE降级、供应商故障、账务对账、密钥轮换和事故 Runbook
- [x] 11.8 在 Staging 执行迁移/备份恢复，验证 consent、Session 撤销、删除和账务事实不会被复活或改写
- [x] 11.9 向前端交付 Base URL、CORS/Cookie/HTTPS、测试账号/验证码、种子测试数据、成功/失败/超时触发方式和接口负责人
- [x] 11.10 用 Feature Flag 逐能力关闭 Mock，完成联调、灰度、API/Worker独立回滚和 R1.0 Go/No-Go 验收
