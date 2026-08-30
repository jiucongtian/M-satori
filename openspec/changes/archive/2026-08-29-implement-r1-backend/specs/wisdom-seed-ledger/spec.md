## ADDED Requirements

### Requirement: Single wisdom seed account and immutable ledger
系统 SHALL 为每个用户维护一个智慧种子账户，并通过 `GET /api/v1/me/wisdom-seed-account` 与游标分页的 `GET /api/v1/me/wisdom-seed-transactions` 返回 available、reserved、累计获得/消费和不可变流水。余额变化 MUST 与流水在同一数据库事务中提交。

#### Scenario: User reads account and transactions
- **WHEN** 已认证用户查询种子账户和下一页流水
- **THEN** 系统仅返回该用户账户、稳定游标顺序和每笔交易后的余额

### Requirement: Exactly-once registration reward
系统 SHALL 通过 `GET /api/v1/me/registration-reward` 查询资格和状态，并通过要求 `Idempotency-Key` 的 `POST /api/v1/me/registration-reward/claim` 主动领取 3 颗新用户赠礼；每个用户和 `NEW_USER_ONBOARDING` 最多产生一次 `GRANT` 流水，重复触发返回原结果。

#### Scenario: Eligible user claims reward twice
- **WHEN** 用户以相同或不同网络重试领取同一注册赠礼
- **THEN** 系统只增加一次余额并返回同一 reward 与 transaction 标识

#### Scenario: Ineligible user claims reward
- **WHEN** 不满足活动版本或资格规则的用户请求领取
- **THEN** 系统返回稳定资格错误且不写入账户流水

### Requirement: Atomic reserve, consume, and release
系统 SHALL 以唯一业务键提供种子预占、核销和释放操作；并发操作 MUST 串行化账户余额，余额不得为负。

#### Scenario: Balance is sufficient
- **WHEN** 每日指引以新业务键预占所需种子
- **THEN** 系统原子减少 available、增加 reserved 并追加 `RESERVE` 流水

#### Scenario: Balance is insufficient
- **WHEN** 请求预占金额大于 available
- **THEN** 系统拒绝预占且账户快照和流水均不改变

#### Scenario: Reserved work succeeds
- **WHEN** 已预占的每日指引成功交付
- **THEN** 系统按同一业务键核销 reserved 并追加一次 `CONSUME` 流水

#### Scenario: Reserved work fails
- **WHEN** 已预占任务永久失败或超时
- **THEN** 系统释放 reserved、恢复 available 并追加一次 `RELEASE` 流水

### Requirement: Compensating refunds and reconciliation
系统 SHALL 通过追加 `REFUND` 或 `ADJUSTMENT` 流水纠正已核销交易，禁止更新或删除历史流水，并提供账户快照与流水求和的对账检查。

#### Scenario: Delivered content is invalidated after consume
- **WHEN** 运维对已核销但未有效交付的业务执行授权补偿
- **THEN** 系统追加关联原交易的退款流水并恢复余额，不改写原消费流水
