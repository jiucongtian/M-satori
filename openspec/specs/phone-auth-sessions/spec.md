# phone-auth-sessions Specification

## Purpose
TBD - created by archiving change implement-r1-backend. Update Purpose after archive.
## Requirements
### Requirement: Rate-limited SMS challenge
系统 SHALL 通过 `POST /api/v1/auth/sms-challenges` 为合法手机号创建短期验证码挑战，要求 `Idempotency-Key`，并按手机号、IP 和设备限流；验证码 MUST 只保存不可逆摘要。

#### Scenario: Challenge is issued
- **WHEN** 客户端提交合法手机号且未触发频率限制
- **THEN** 系统返回 challengeId、过期时间和重发时间，并通过短信适配器发送验证码

#### Scenario: Challenge is rate limited
- **WHEN** 任一限流维度超过阈值
- **THEN** 系统返回 `SMS_RATE_LIMITED`、Retry-After 和限流响应头且不调用短信供应商

### Requirement: Idempotent registration and sign-in
系统 SHALL 通过 `POST /api/v1/auth/sessions` 校验一次性挑战；已有账号登录原用户，首次手机号在事务中只创建一个 User、Identity、Session、种子账户和赠礼资格。

#### Scenario: New phone completes verification
- **WHEN** 未绑定手机号提交有效且未消费的 challenge、验证码及幂等键
- **THEN** 系统创建一次用户主体，返回 Access Token、用户摘要、nextAction 和 requiresConsent

#### Scenario: Existing phone completes verification
- **WHEN** 已绑定手机号提交有效验证码
- **THEN** 系统返回原用户 Session 且不创建重复用户、账户或赠礼

#### Scenario: Code cannot be accepted
- **WHEN** 验证码错误、过期、超过尝试次数或已消费
- **THEN** 系统返回 API v1 稳定认证错误且不泄露手机号是否已有账号

### Requirement: Refresh token only in secure cookie
系统 SHALL 仅通过 `Set-Cookie` 写入 `HttpOnly + Secure + SameSite=Lax` Refresh Token；Refresh Token MUST NOT 出现在 JSON、URL或日志中。`POST /api/v1/auth/sessions/refresh` SHALL 从 Cookie 读取并轮换，`DELETE /api/v1/auth/sessions/current` SHALL 撤销 Session 并清除 Cookie。

#### Scenario: Login succeeds
- **WHEN** Session 创建成功
- **THEN** JSON 仅含 Access Token 和会话元数据，响应同时设置 Refresh Cookie

#### Scenario: Refresh succeeds
- **WHEN** 浏览器携带有效且未使用的 Refresh Cookie
- **THEN** 系统轮换 Cookie、撤销旧 refresh token 并返回新的 Access Token

#### Scenario: Refresh token reuse is detected
- **WHEN** 已轮换的 refresh token 再次出现
- **THEN** 系统撤销 session family、清除 Cookie 并记录安全审计事件

#### Scenario: User signs out
- **WHEN** 已认证用户退出当前 Session
- **THEN** 系统返回 204，当前 Session 失效且 Refresh Cookie 被清除

### Requirement: Credentialed CORS and server authorization
系统 SHALL 只允许配置的 H5 origin 携带凭证 Cookie，禁止 credentialed wildcard CORS；每个受保护请求 MUST 校验 Access Token、Session、用户状态、consent gate 和资源所有权。

#### Scenario: Consent is still required
- **WHEN** requiresConsent 用户请求非白名单业务接口
- **THEN** 系统返回 `409 CONSENT_REQUIRED`，但仍允许访问 `/me`、`/me/consents`、协议查询、刷新和退出

#### Scenario: Revoked session requests private data
- **WHEN** 已撤销 Session 请求 `/api/v1/me`
- **THEN** 系统返回 `SESSION_REVOKED` 且不读取或返回私有数据
