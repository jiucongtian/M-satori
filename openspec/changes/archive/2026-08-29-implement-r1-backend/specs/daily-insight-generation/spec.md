## ADDED Requirements

### Requirement: Create or return today's insight
系统 SHALL 通过要求 `Idempotency-Key` 的 `POST /api/v1/daily-insights/today` 根据服务端保存的用户生活时区确定 localDate，并按 R1.0 配置预占 1 颗智慧种子；同一 subject、本地日期、时区和内容策略版本只能有一个正式 DailyInsight。

#### Scenario: Today's insight does not exist
- **WHEN** consent 已满足、Active Profile/四张卡牌有效且种子充足的用户创建今日指引
- **THEN** 系统在同一事务中创建 DailyInsight、GenerationTask、种子预占和 Outbox，并返回 202、task 和安全 fallback

#### Scenario: Today's insight is already ready
- **WHEN** 用户再次调用今日命令且资源已发布
- **THEN** 系统返回 200 和同一 DailyInsight，不创建任务或重复结算

#### Scenario: User has insufficient seeds
- **WHEN** available 小于配置价格
- **THEN** 系统返回稳定余额不足错误且不创建 DailyInsight、Task 或流水

### Requirement: Query by local date and history
系统 SHALL 通过 `GET /api/v1/daily-insights/{localDate}` 只查询指定本地日期资源，通过 `GET /api/v1/daily-insights` 以不透明 cursor 返回历史；GET 请求不得触发生成。

#### Scenario: User queries an existing local date
- **WHEN** 用户请求合法 YYYY-MM-DD 且拥有该 DailyInsight
- **THEN** 系统返回该日稳定内容、状态、版本摘要和 SeedSettlement

#### Scenario: Date has no insight
- **WHEN** 指定日期不存在资源
- **THEN** 系统返回 `DAILY_INSIGHT_NOT_FOUND` 且不隐式创建任务

### Requirement: Versioned asynchronous generation without life-report prerequisite
系统 SHALL 使用创建时固化的 Active Profile revision、四张关系卡牌、算法、知识、Workflow、Schema 和安全策略版本生成内容；R1.0 MUST NOT 要求 READY 独立人生报告。发布前必须完成结构、事实和安全校验。

#### Scenario: Worker generates valid content
- **WHEN** Aqua/生成适配器返回通过全部校验的结构化内容
- **THEN** 系统原子发布 DailyInsight、保存 GenerationManifest、标记 Task READY 并核销种子

#### Scenario: Dependency fails temporarily
- **WHEN** 生成依赖发生可恢复超时
- **THEN** Worker 按策略重试原 Task/attempt 链，不重复预占或核销

#### Scenario: Generation permanently fails
- **WHEN** 重试耗尽或内容无法通过强制校验
- **THEN** 系统标记可见失败、释放预占种子并保留安全可审计原因

### Requirement: Stable content and settlement response
完成的 DailyInsight SHALL 返回 localDate、timezone、profileRevisionId、稳定内容 schema、发布时间和 `SeedSettlement`；生成中只返回 task/fallback，不得返回未校验半成品。

#### Scenario: Owner polls a generating date
- **WHEN** 用户按 localDate 查询生成中的资源
- **THEN** 系统返回 GENERATING、taskId、fallback 和 RESERVED settlement，不返回正文

#### Scenario: Another user requests the date resource
- **WHEN** 请求无法解析为当前用户拥有的 DailyInsight
- **THEN** 系统返回 404 且不泄露资源、结算或失败细节
