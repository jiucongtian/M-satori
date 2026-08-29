## ADDED Requirements

### Requirement: Current user routing state
系统 SHALL 通过 `GET /api/v1/me` 返回当前用户、生活时区、用户/档案状态、consent 状态、`requiresConsent` 和稳定 `nextAction`，供新用户、老用户和未完成用户分流。

#### Scenario: New user has not accepted current policies
- **WHEN** 新 Session 用户查询 `/me`
- **THEN** 系统返回 requiresConsent=true、待同意协议及 `ACCEPT_CONSENTS`，不伪造档案或首页状态

#### Scenario: Returning active user queries me
- **WHEN** 已同意协议且档案有效的老用户查询 `/me`
- **THEN** 系统返回对应稳定状态和 `VIEW_HOME` 或当日下一动作

### Requirement: Patch user preferences
系统 SHALL 通过 `PATCH /api/v1/me/preferences` 更新支持的 locale、生活时区等偏好，并返回规范化结果和更新时间。

#### Scenario: User changes living timezone
- **WHEN** 用户提交有效 IANA 时区
- **THEN** 系统更新后续本地日期解析依据，但不改写已生成 DailyInsight 的 localDate

### Requirement: Versioned consent acceptance
系统 SHALL 通过要求 `Idempotency-Key` 的 `POST /api/v1/me/consents` 接受 bootstrap 指定的必要协议版本，并保存文档、版本、用途、时间、客户端版本和可验证证据。

#### Scenario: User accepts all required policies
- **WHEN** 用户提交当前必要协议的精确 documentId/version
- **THEN** 系统幂等保存 ConsentRecord、清除 requiresConsent 并返回新的 nextAction

#### Scenario: Client submits stale policy version
- **WHEN** 用户接受的版本已不是当前必要版本
- **THEN** 系统返回稳定冲突错误及当前安全版本信息，不记录无效同意

### Requirement: Home overview aggregation
系统 SHALL 通过 `GET /api/v1/me/home-overview` 聚合建档状态、四张关系卡牌摘要、注册赠礼、智慧种子余额和今日指引状态，并返回稳定 nextAction；不得返回其他用户数据。

#### Scenario: Active profile opens home
- **WHEN** 已激活档案用户请求首页
- **THEN** 系统返回当前档案/cards、种子摘要和本地今日指引状态

#### Scenario: Incomplete profile opens home
- **WHEN** 档案尚未确认用户请求首页
- **THEN** 系统返回 `CONFIRM_PROFILE` 等恢复动作而不伪造已激活内容

### Requirement: Content feedback
系统 SHALL 通过要求 `Idempotency-Key` 的 `POST /api/v1/feedback` 接受 `LIFE_REPORT` 或 `DAILY_INSIGHT` 目标、API v1 rating/reason 和受限自由文本，并校验目标所有权与内容版本。

#### Scenario: User submits daily insight feedback
- **WHEN** 用户对自己的 DailyInsight 提交合法反馈
- **THEN** 系统保存反馈历史且不修改源内容、档案或账务事实

### Requirement: Account deletion request lifecycle
系统 SHALL 通过 `POST /api/v1/me/account-deletion-requests` 创建经短信重新认证的注销申请，通过 `GET /api/v1/me/account-deletion-request` 查询，并通过 `DELETE /api/v1/me/account-deletion-request` 在允许时撤回。

#### Scenario: User requests deletion
- **WHEN** 用户提交有效 DELETE_ACCOUNT challenge、验证码、原因和幂等键
- **THEN** 系统创建一次请求、返回 202 状态并按策略撤销不必要 Session

#### Scenario: User withdraws a cancellable request
- **WHEN** 当前注销申请仍可撤回
- **THEN** 系统返回 204、恢复允许的账号状态并保留完整审计轨迹
