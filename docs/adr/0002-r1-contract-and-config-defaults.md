# ADR-0002：R1.0 候选契约与配置默认值

- 状态：Accepted
- 日期：2026-08-10
- 依据：冻结的 R1.0 前端交互、API v1 文档和 ADR-0001

## 决策

### 注册赠礼

- 采用用户主动领取，与 GIFT-01“收下 3 颗智慧种子”交互一致。
- `GET /api/v1/me/registration-reward` 查询资格和状态。
- `POST /api/v1/me/registration-reward/claim` 要求 `Idempotency-Key`，请求体为空对象。
- 响应同时返回 reward、更新后的 account 摘要和唯一 GRANT transaction。
- 同一用户、`NEW_USER_ONBOARDING` reward type 恰好一次入账；重复领取返回首次结果。

### 生命智慧档案库

- `GET/POST /api/v1/me/life-profiles`：游标列表和创建 OTHER 档案；SELF 由本人档案流程维护。
- `GET/PATCH/DELETE /api/v1/me/life-profiles/{profileId}`：详情、可变元数据和删除。
- `GET /api/v1/me/life-profiles/{profileId}/revisions`：版本历史。
- `POST /api/v1/me/life-profiles/{profileId}/revisions/preview` 和 `POST /api/v1/me/life-profiles/{profileId}/revisions/{revisionId}/confirm`：复用本人 preview/confirm 语义。
- PATCH 可更新 displayName、relationshipType、groupId；出生资料不能通过 PATCH 覆盖。

### 档案分组

- `GET/POST /api/v1/me/life-profile-groups`：排序列表和创建。
- `PATCH/DELETE /api/v1/me/life-profile-groups/{groupId}`：重命名/排序和删除。
- 删除分组只清空档案 groupId，不删除档案。

### 智慧种子

- `GET /api/v1/me/wisdom-seed-account` 返回 available、reserved、totalEarned、totalSpent、updatedAt。
- `GET /api/v1/me/wisdom-seed-transactions` 使用 cursor/limit，返回 type、amount、balanceAfter、businessType、resourceId、originalTransactionId 和 createdAt。
- R1.0 每日指引价格为 1 颗；新用户赠礼为 3 颗。
- Settlement 返回 currency=`WISDOM_SEED`、amount、status、transactionId。

### 配置初值

| 配置 | R1.0 初值 |
| --- | --- |
| 必要协议 | API v1 文档中的隐私政策、用户协议、AI 内容说明，version `1.0` |
| 验证码有效期 | 5 分钟 |
| 验证码重发间隔 | 60 秒 |
| 单 challenge 最大失败次数 | 5 |
| 手机号发送限流 | 5 次/小时 |
| 设备发送限流 | 10 次/小时 |
| IP 发送限流 | 20 次/小时 |
| Access Token 有效期 | 30 分钟 |
| Refresh Session 有效期 | 30 天，使用即轮换 |
| Idempotency 记录保留 | 7 天，且不得短于关联任务最大重试窗口 |
| 档案 Preview 有效期 | 24 小时 |
| 默认/最大分页 | 20 / 50 |
| 每日指引历史可见 | 90 天 |
| 每日指引价格 | 1 颗智慧种子 |
| 注册赠礼 | 3 颗智慧种子 |

所有初值必须进入版本化配置并记录修改人、生效时间和回滚版本，不得作为散落的业务常量。

## 后果

- 前端必须在用户点击领取时调用 claim；进入 GIFT-01 前可通过 GET 恢复 AVAILABLE/CLAIMED 状态。
- 注册创建种子账户和赠礼资格，但不自动增加 available。
- 每日指引创建事务必须预占 1 颗；成功核销，失败释放或退款。
- 候选接口进入 OpenAPI 3.1 后状态升级为 `CONTRACT_FROZEN`。
