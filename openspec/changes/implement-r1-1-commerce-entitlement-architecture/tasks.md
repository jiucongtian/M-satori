## 1. 契约冻结与架构边界

- [x] 1.1 编写 ADR，确认模块化单体、模块所有权、两套独立账本、统一消费端口和跨模块 Outbox/Saga 原则
- [x] 1.2 冻结 ServiceOffering、OfferingVersion、CheckoutQuote、MoneyOrder、PaymentAttempt、FulfillmentJob、Refund、EntitlementGrant、ComplimentarySeedGrant、EntitlementResolution、ConsumptionIntent、MembershipSubscription 和 MembershipUpgrade 枚举
- [x] 1.3 冻结商品、报价、订单、支付、权益、核销、会员与普通退款 API 路径、DTO、错误码和游标分页语义
- [x] 1.4 冻结领域事件目录、事件版本、幂等业务键、业务上下文标识及 producer/consumer 负责人
- [x] 1.5 冻结自然日有效期、15 分钟报价、30 分钟未支付订单、30 分钟抽卡前预留和系统固定核销优先级配置
- [x] 1.6 冻结普通商品 RefundPolicy 配置模型，并明确会员升级旧周期剩余价值不进入退款流程
- [x] 1.7 更新 OpenAPI 3.1 候选契约并生成前端 Client 类型，增加 schema 与 breaking-change 校验
- [x] 1.8 为六份 capability 建立需求—接口—表—事件—测试追踪矩阵

## 2. 模块骨架与共享基础

- [x] 2.1 创建 catalog、pricing、order、payment、fulfillment、membership、entitlement、complimentary-seed 和 consumption NestJS 模块
- [x] 2.2 为每个模块建立 domain/application/controller/repository-adapter 目录和公开 barrel，禁止导出 ORM 表与内部 repository
- [x] 2.3 定义 PaymentProvider、BenefitSourcePort、ConsumptionPort、EntitlementGrantPort、MembershipGrantPort 和业务时钟端口
- [x] 2.4 为 API 与 Worker 装配新增模块，保持 Controller 仅调用应用服务
- [x] 2.5 增加模块依赖边界测试，阻止 payment 依赖权益、业务模块直接依赖账本以及跨模块导入 schema 表
- [x] 2.6 扩展幂等存储以覆盖所有新增命令并验证相同 key 不同载荷返回冲突
- [x] 2.7 建立版本化领域事件 envelope、Inbox/消费去重基线和失败重试策略
- [x] 2.8 完成本阶段 typecheck、lint、模块装配测试并提交推送独立里程碑

## 3. 数据模型与迁移基线

- [x] 3.1 创建 service_offerings、offering_versions、seed_promotion_rules 和 checkout_quotes 表及版本/状态/有效期约束
- [x] 3.2 创建 money_orders、order_snapshots、payment_attempts、payment_events、refunds 和 fulfillment_jobs 表及唯一约束
- [x] 3.3 创建 entitlement_grants、entitlement_usage_entries 及 available/reserved 非负、来源和业务空间约束
- [x] 3.4 创建 complimentary_seed_grants、complimentary_seed_allocations、complimentary_seed_entries 和账户投影表及约束
- [x] 3.5 创建 entitlement_resolutions、resolution_candidates、consumption_intents 和 reservation_allocations 表及状态约束
- [x] 3.6 创建 membership_subscriptions、membership_periods、membership_upgrades 和 upgrade_assessments 表及单一有效周期约束
- [x] 3.7 创建 reconciliation_cases、operator_adjustments 和新增审计关联字段
- [x] 3.8 为所有表补充 owner/businessSpace/source/businessContext/requestId/version/UTC 时间索引和稳定游标索引
- [x] 3.9 生成并审查 expand-only Drizzle migration，验证已有 R1.0 数据不受影响
- [x] 3.10 添加数据库约束集成测试及迁移前进、回滚兼容和空库启动验证

## 4. 商品目录、会员方案与权威报价

- [x] 4.1 实现 ServiceOffering 与不可变 OfferingVersion repository、发布命令和历史查询
- [x] 4.2 实现 R1.1 可售范围白名单，拒绝生命之光、月运、年运、关系报告、真人服务和实体商品付款
- [x] 4.3 实现今日能量单次/新客包、问事单次/10次包及微光/清和/自在三档 30 天方案种子数据
- [x] 4.4 实现 SeedPromotionRule 的业务空间、身份、商品、种子门槛、活动人民币价、限次、有效期和恢复规则
- [x] 4.5 实现服务端 CheckoutQuote 计算、用户绑定、商品/活动资格/限购校验和 15 分钟过期
- [x] 4.6 实现标准价与种子活动价返回，确保不输出固定种子汇率、人民币抵扣或组合支付表达
- [x] 4.7 实现商品列表、详情、会员方案和创建报价接口及 OpenAPI 契约测试
- [x] 4.8 添加并发新客限购、商品下架、版本变更、报价过期和活动资格边界测试
- [x] 4.9 完成本阶段单元/契约/集成测试并提交推送独立里程碑

## 5. 服务权益批次与只追加账本

- [x] 5.1 实现 EntitlementGrant 创建、查询和按来源分组的用户权益视图
- [x] 5.2 实现基于 `Asia/Shanghai` 支付成功日期的第 N 个自然日末到期计算并保存 UTC、时区和规则版本
- [x] 5.3 实现 GRANT、RESERVE、COMMIT、RELEASE、REVERSE、EXPIRE、FREEZE、UNFREEZE、FORFEIT 和 ADJUSTMENT 只追加流水
- [x] 5.4 实现账户/批次行锁、非负余额检查、reservation 单次结算和业务唯一键幂等
- [x] 5.5 实现同类权益按 expiresAt、grantedAt、id 稳定排序的候选查询
- [x] 5.6 实现多个相同权益包独立批次、独立到期且不合并/延期的行为
- [x] 5.7 实现到期任务、退款冻结/解冻、会员升级作废和人工调整应用命令
- [x] 5.8 实现权益列表、详情、使用记录接口及稳定游标分页
- [x] 5.9 实现批次投影—流水—有效 ConsumptionIntent 对账命令和异常 case 生成
- [x] 5.10 添加最终单位并发预留、重复提交/释放、跨日到期、多包排序和账本不变量测试

## 6. 智慧种子批次账本与迁移

- [x] 6.1 实现 ComplimentarySeedGrant 的来源、适用服务、数量、有效期和规则版本模型
- [x] 6.2 实现种子 GRANT、RESERVE、CONSUME、RELEASE、RESTORE、EXPIRE 和 ADJUSTMENT 只追加流水
- [x] 6.3 实现跨多个种子批次按最早到期稳定分配的 reservation allocations
- [x] 6.4 实现基于卡牌张数和版本化规则的问事种子成本计算与快照
- [x] 6.5 实现活动价报价校验、订单创建预留、支付成功消耗及订单取消/超时/支付失败释放
- [x] 6.6 将现有 seed_accounts/seed_entries 余额映射为 opening grant，保留来源、历史记录和迁移版本
- [x] 6.7 编写可重复运行的种子迁移脚本和迁移前后 available/reserved/累计流水对账报告
- [x] 6.8 将用户级种子账户改为批次账本的查询投影并保持 R1.0 API 兼容
- [x] 6.9 增加迁移失败回滚开关、旧读模型影子比对和迁移完成门禁
- [x] 6.10 添加范围限制、批次到期、多批次分配、活动价预留、并发与迁移黄金数据测试
- [x] 6.11 完成本阶段账本对账和兼容回归后提交推送独立里程碑

## 7. 固定核销决策与消费意图

- [x] 7.1 实现 ServiceRequirement、EntitlementResolution、ResolutionCandidate 和 ConsumptionIntent 领域模型
- [x] 7.2 实现 BenefitSourcePort 两套适配器并确保 consumption 不直接访问账本表
- [x] 7.3 实现会员当期权益 → 最早到期购买权益包 → 最早到期种子批次的系统固定优先级
- [x] 7.4 实现候选快照、选中来源、原因、成本、规则版本和 `SYSTEM_RULE` 记录
- [x] 7.5 移除用户切换来源能力，不提供 selection 接口且拒绝客户端指定 sourceId
- [x] 7.6 实现创建消费意图并原子调用选中来源预留，余额竞争时安全重算或返回冲突
- [x] 7.7 实现抽卡前 30 分钟 reservation deadline、正式抽卡后转 RUNNING 并取消短超时
- [x] 7.8 实现完整交付 COMMIT、失败/取消 RELEASE 和 `intentId + action` 幂等键
- [x] 7.9 实现按 businessContext 查询和重放，以恢复“已预留但调用方未收到响应”的中断
- [x] 7.10 实现悬挂预留扫描与消费意图—业务任务—账本流水对账修复任务
- [x] 7.11 实现 resolve/consume 查询 API，只返回系统选择及白话来源提示
- [x] 7.12 添加全来源组合、用户伪造来源、30 分钟边界、长生成、并发竞争和崩溃恢复测试

## 8. R1.0 每日指引迁移与问事接入基线

- [x] 8.1 为 daily-insight 定义 ConsumptionPort 适配并移除对 SeedLedgerService 的新增直接依赖
- [x] 8.2 在影子模式同时计算旧种子结算与新 resolution，记录差异但只由旧路径结算
- [x] 8.3 修复影子差异后切换每日指引为新消费意图的预留、核销和恢复路径
- [x] 8.4 验证既有每日指引 API、种子账户、历史流水和失败恢复兼容性
- [x] 8.5 为 card-reading 定义 opaque ReadingIntent 业务上下文和 `1 READING_CREDIT`/按卡数种子 requirement 构造器
- [x] 8.6 提供“预留成功后才允许服务端抽卡”的应用端口与契约测试
- [x] 8.7 提供 GenerationTask READY/FAILED/CANCELLED 到 COMMIT/RELEASE 的幂等事件适配器
- [x] 8.8 完成已有权益问事最短链路 Fake E2E：resolve → reserve → draw gate → ready → commit
- [x] 8.9 完成失败与恢复 E2E：reserve → draw → generation fail → release，重试不换牌且不重复核销

## 9. 人民币订单与微信支付

- [x] 9.1 实现从有效 CheckoutQuote 创建 MoneyOrder、保存完整快照、限购原子校验和幂等重放
- [x] 9.2 实现未支付订单 30 分钟自动关闭及种子活动 reservation 的准确释放
- [x] 9.3 定义 PaymentProvider 并实现确定性 Fake、故障注入和 WeChat Pay 适配器配置
- [x] 9.4 实现创建 PaymentAttempt、客户端支付参数、主动查单和支付状态查询
- [x] 9.5 实现微信支付回调验签、商户/订单/金额/币种复核、原文最小化保存和 provider event 去重
- [x] 9.6 实现一个订单最多一个成功资金事实和重复/乱序回调安全处理
- [x] 9.7 在支付成功事务内更新支付事实、消耗活动种子 reservation 并写入 FulfillmentRequested Outbox
- [x] 9.8 实现订单列表/详情、支付尝试和支付结果接口，区分 paid 与 fulfilled
- [x] 9.9 添加报价过期、重复下单、支付取消/失败/处理中、回调伪造/重复/乱序和关闭竞争测试
- [ ] 9.10 使用微信沙箱或测试商户完成签名、回调、主动查单和金额一致性联调
- [ ] 9.11 完成本阶段资金对账和安全评审后提交推送独立里程碑

## 10. 交付 Saga 与异常补偿

- [x] 10.1 实现 FulfillmentJob 状态机、Outbox 消费、重试、退避、超时、死信和幂等业务键
- [x] 10.2 实现按订单快照发放单次权益包、10次权益包或创建会员周期的交付命令
- [x] 10.3 实现支付成功但交付未完成时 `PAID/FULFILLING` 查询和前端提示
- [x] 10.4 实现交付成功后订单 FULFILLED、来源权益引用和事件审计
- [x] 10.5 实现交付最终失败的异常原路退回请求并防止用户重复购买
- [x] 10.6 实现支付—订单—交付—权益/会员关联对账和可重放修复任务
- [x] 10.7 添加 Outbox 重投、Worker 崩溃、权益发放重复、会员创建重复和最终失败补偿测试
- [x] 10.8 完成“权益不足 → 下单 → 支付 → 发放 → 返回原业务上下文”的端到端测试

## 11. 会员周期、续费与替换式升级

- [x] 11.1 实现 MembershipPlanVersion 到 MembershipSubscription/Period 的快照映射
- [x] 11.2 实现同一业务空间单一 ACTIVE 周期和有序未来续费周期约束
- [x] 11.3 实现无有效会员时支付交付后立即开始 30 天周期并幂等发放服务权益
- [x] 11.4 实现有效会员手动续费排队、周期结束后自动开始且不提前发放下一周期权益
- [x] 11.5 实现周期结束、未使用会员权益到期且不结转的只追加流水
- [x] 11.6 实现允许的微光→清和、微光→自在、清和→自在升级校验和全额新订单
- [x] 11.7 实现 MembershipUpgrade Saga：新方案安全激活后终止旧周期并作废旧权益
- [x] 11.8 实现 remainingTimeRatio、remainingQuotaRatio、residualValueEstimate 和 assessmentRuleVersion 内部快照
- [x] 11.9 保证剩余价值不改变新订单金额、不创建 Refund、不形成财务应付且不进入用户退款页面
- [x] 11.10 实现升级确认文案契约，明确原方案结束和剩余次数不保留但不展示退款规则
- [x] 11.11 实现新计划无法履约时保留旧会员并处理新订单异常退回的补偿路径
- [x] 11.12 实现会员详情、周期、续费和升级状态 API 及后台查询
- [x] 11.13 添加周期边界、重复 Worker、并发续费/升级、权益不结转和升级中断恢复测试
- [ ] 11.14 完成本阶段会员与资金/权益对账后提交推送独立里程碑

## 12. 普通退款、后台调整与对账运营

- [x] 12.1 实现版本化 RefundPolicy、退款报价、资格校验和订单快照规则读取
- [x] 12.2 实现普通退款申请时冻结剩余权益、支付渠道原路退款、成功反向流水和失败重试
- [x] 12.3 实现重复扣款及最终无法履约的系统自动异常原路退回
- [x] 12.4 明确阻断会员升级旧周期剩余价值进入任何退款接口或 PaymentProvider 退款命令
- [x] 12.5 实现受 RBAC 保护的补发、释放、恢复、作废和冲正命令，强制原因码、操作者与关联业务 ID
- [x] 12.6 实现订单、支付、退款、交付、权益、种子、消费意图和会员的运营查询视图
- [x] 12.7 实现日常自动对账、异常 case 生命周期、指标、告警和可审计修复流程
- [x] 12.8 添加越权、直接改余额防护、重复退款、退款/核销竞争和人工调整审计测试

## 13. H5 联调、可观测性与安全

- [x] 13.1 对接商品商城、商品详情、会员方案、报价、订单确认、微信支付和支付结果页面
- [x] 13.2 对接我的权益、来源分组、使用记录、订单、普通退款、会员周期和升级页面
- [x] 13.3 对接固定核销提示，确保前端不提供切换来源入口且不自行计算价格或优先级
- [x] 13.4 保存支付返回前的 opaque businessContext 并验证支付后恢复原问事流程
- [x] 13.5 增加 requestId、orderId、paymentAttemptId、fulfillmentId、subscriptionId、grantId 和 consumptionIntentId 关联日志
- [x] 13.6 增加报价转化、支付结果、交付延迟、悬挂预留、账本不一致、周期漏发和对账异常指标
- [x] 13.7 完成支付证书/密钥管理、回调网络限制、敏感字段脱敏、商业模块不读取问事正文和审计安全检查
- [x] 13.8 编写支付故障、悬挂预留、交付失败、账本修复、会员周期与对账 Runbook

## 14. 质量门禁、迁移与发布

- [x] 14.1 执行全部六份 capability 的场景追踪和 OpenSpec/OpenAPI 严格校验
- [x] 14.2 完成商品报价、服务权益、种子账本、固定核销、订单支付交付和会员生命周期单元测试门禁
- [x] 14.3 完成 PostgreSQL 真实事务、行锁、迁移、Outbox/Inbox 和对账集成测试
- [x] 14.4 完成重复点击、多端并发、弱网重试、回调乱序、Worker 崩溃、跨日到期和最终补偿 E2E
- [x] 14.5 执行商品/报价/订单/权益查询 P95、并发预留、支付回调和 Worker 积压压测并冻结 SLO
- [ ] 14.6 在测试环境部署前先拉取服务器最新代码，处理并确认合并结果后执行 expand migration
- [ ] 14.7 在测试环境迁移种子 opening grants，核对新旧 available/reserved 与流水报告并保持旧读模型回退开关
- [ ] 14.8 使用 Feature Flag 按商品报价 → 已有权益核销 → 权益包支付 → 会员开通续费 → 普通退款 → 会员升级顺序灰度
- [ ] 14.9 验证关闭新订单后仍能完成或补偿所有已支付订单，并演练 API/Worker/支付回调/数据库兼容回滚
- [ ] 14.10 完成财务、客服、产品、前端、后端、测试和运维 Go/No-Go 评审及交付证据归档
- [x] 14.11 更新 R1.1 交接文档、接口状态、部署说明、对账说明和已知限制
- [ ] 14.12 完成最终回归、OpenSpec 状态核验并提交推送发布里程碑
