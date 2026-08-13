# GitHub Issues 联调管理规范

## 1. 唯一事实源

`jiucongtian/M-satori` 的 GitHub Issues 是设计、开发、联调和测试问题的唯一事实源。Codex、飞书和即时聊天用于分析与沟通，不维护第二份问题台账。

Codex 通过 GitHub 连接器直接查询和更新同一批 Issues，并按需生成实时看板与统计。

## 2. Issue 生命周期

```text
待复现 → 已复现/待定位 → 处理中 → 待部署 → 待验证 → 已关闭
```

特殊状态：`需要产品确认`、`接口契约待确认`、`暂不处理`、`无法复现`。

提交代码不等于关闭问题。关闭前必须记录修复 commit、测试结果、测试环境部署版本和回归结论。

## 3. 标签体系

### Release

- `release:R1.0`
- `release:R1.1`
- 后续版本按相同规则新增

### 优先级

- `priority:P0`：系统或联调阻断
- `priority:P1`：Release 核心闭环阻断
- `priority:P2`：明显功能或体验错误
- `priority:P3`：轻微体验与优化建议

### 责任域

- `area:frontend`
- `area:backend`
- `area:api-contract`
- `area:data`
- `area:deployment`
- `area:product`
- `area:triage`

### 状态

- `status:needs-reproduce`
- `status:investigating`
- `status:in-progress`
- `status:needs-product`
- `status:needs-contract`
- `status:needs-deploy`
- `status:needs-verify`
- `status:deferred`

GitHub 已关闭状态代表 `已关闭`，无需额外创建 `status:closed`。

### 来源

- `found-by:human`
- `found-by:frontend-ai`
- `found-by:backend-ai`
- `found-by:automation`

联调批次标签采用 `batch:R1.0-INT-001` 格式，按实际批次创建。

## 4. 四方协作职责

- 产品负责人：确认预期、Release 范围、优先级和最终体验。
- 前端开发 / 前端 AI：复现页面与请求链路，修复前端，补测试、部署和回归证据。
- 后端开发 / 后端 AI：核查接口、数据、任务与日志，修复后端并同步契约和部署证据。
- 所有人与 AI：先查重再创建 Issue；所有结论回写同一 Issue，引用 Issue 编号沟通。

## 5. 联调批次

每轮开始前使用 `docs/templates/联调批次记录.md` 冻结前端 commit、后端 commit、接口文档版本和测试环境。问题必须关联 Release 和批次。

当一个或多个 Issue 准备合并提交、部署和验收时，使用 `docs/Satori-Release-SOP.md` 与 `docs/templates/发布批次记录.md` 建立 Release 批次。一个批次可以包含多个 Issue，但不得把 Issue 正文复制成第二份问题台账。

## 6. Codex 实时看板口令

可在 Codex 中直接提出：

- “查看 R1.0 所有未关闭问题，按优先级排序。”
- “列出需要后端处理且正在调查的问题。”
- “把刚才的问题按联调模板创建为 P1 Issue。”
- “更新 #25 的修复 commit，并转为待部署。”
- “生成 R1.0-INT-001 联调统计和发布阻塞项。”

Codex 展示的是 GitHub 的实时查询结果，不另行保存看板数据。

## 7. 统计口径

每轮联调和每个 Release 至少统计：新增、关闭、未关闭、P0/P1/P2/P3、责任域、发现来源、重新打开数量和发布阻塞项。

Release 结束时使用 `docs/templates/Release测试汇总.md` 固化结果。

## 8. 安全要求

Issue 中不得写入私钥、Token、验证码、真实手机号、数据库连接信息或个人隐私。日志和请求信息必须脱敏。
