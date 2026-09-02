# 初见·FRESH 运营平台

测试环境使用独立域名 `operations.test.shenxinyou.com` 和独立 `satori-operations` Docker Compose；未来正式环境预留 `operations.shenxinyou.com`。API 与 R1.1 用户端共用 PostgreSQL 权威数据，不复制订单、权益、会员或智慧种子账本。

## 目录

- `frontend/`：按已确认原型还原的运营平台界面与 Playwright 测试。
- `backend/`：运营专用 API，仅允许运营身份访问。
- `deploy/`：独立域名 Nginx 配置。

当前版本使用环境变量 `OPERATIONS_ACCOUNTS_JSON` 配置一个或多个运营账号；旧版单账号变量仍兼容一个发布周期。账号列表中的密码只保存 SHA-256 十六进制摘要。生产环境必须为每个账号使用独立强密码及至少 32 字节 JWT 密钥，不得将用户端 Token 当作运营权限。当前配置账号均拥有相同的超级管理员权限，账号与角色的平台化管理留待后续实现。

高风险动作不会由运营 API 直接改账本：运营人员先提交申请，另一名授权人员审核后，由运营 API 携带短期 `SATORI_OPERATOR_TOKEN` 调用 R1.1 已有领域服务。请求使用唯一幂等键，并把提交、审核、执行结果写入 `operations_action_requests` 与 R1.1 审计日志。

## 部署边界

- `web`：独立 Next.js 容器，只暴露 `127.0.0.1:6900`。
- `api`：独立 Fastify 容器，只暴露 `127.0.0.1:3210`。
- `operations.test.shenxinyou.com`：测试环境 Nginx 将 `/operations-api/` 转发到 API，其余请求转发到 Web。
- `operations.shenxinyou.com`：仅用于未来正式环境，不复用测试环境密钥、数据库或容器。
- 数据库：复用 R1.1 PostgreSQL 权威库，不建立影子用户、订单或权益账本。
- DNS、TLS 证书和生产密钥由部署环境提供，不能提交 Git。
