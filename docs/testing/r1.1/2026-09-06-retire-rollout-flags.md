# R1.1 阶段开关退出验证（2026-09-06）

## 变更范围

移除 `R11_CATALOG_PRICING_ENABLED`、`R11_ENTITLEMENT_CONSUMPTION_ENABLED`、`R11_NEW_ORDERS_ENABLED`、`R11_MEMBERSHIP_ENABLED`、`R11_ORDINARY_REFUNDS_ENABLED`、`R11_MEMBERSHIP_UPGRADES_ENABLED` 的 Schema、环境模板以及 API 阶段拦截。没有替代开关；已交付功能随版本正常开放。

保留原有身份校验、协议校验、请求参数验证、支付回调网络限制、业务校验和后台结算。两个账本迁移模式不在本次变更范围内；无数据库结构变更。

起始代码：`85eda6d`（提交前已同步 `origin/release/r1.1`）。GitNexus upstream 影响分析：`disabledCommerceFeature` 直接调用者为 `configureApi`，再到启动入口；`configureApi` 直接调用者为 `bootstrap`，均为 LOW。变更检测与人工差异检查确认只涉及配置、入口测试和说明文档。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| TypeScript 类型检查、后端构建 | 通过 |
| 修改文件 ESLint | 通过 |
| 单元测试 | 44 文件、305 项通过 |
| 契约测试 | 2 文件、27 项通过 |
| 基础 API 集成测试 | 4 项通过 |
| 阶段开关退出专项 | 42 项，包含在单元测试总数中 |

专项使用真实 Controller、AccessTokenGuard、ValidationPipe 和回调网络 Guard，业务依赖为测试替身。覆盖旧变量缺省及残留 `false` 两种场景：已登录目录访问、未登录写请求拒绝、非法参数拒绝、公开回调原始请求体及不可信网络拒绝。它不代替真实支付验签或数据库业务测试。

全仓 ESLint 存在两处基线问题，已将 `HEAD` 原文件通过 stdin 重新检查确认同样失败，本次未修改：

- `packages/modules/src/consumption/application/index.spec.ts:15`：多余类型断言。
- `tests/integration/entitlement-ledger.test.ts:99`：测试断言中的 unsafe assignment。

## 测试服务器隔离验证

位置：`/opt/satori-test/integration/r11-retire-flags-20260906`。候选源码构建独立镜像；测试使用全新 PostgreSQL、Redis 和独立网络，不挂载运行环境文件，不连接现有业务数据库。

- 配置及真实入口专项：49 项通过（含环境配置的 7 项）。
- 订单支付交付与退款、会员周期与替换升级、统一消费及权益账本：4 文件、25 项通过。
- 登录 E2E：10 项通过、2 项每日指引用例失败。以 `85eda6d` 修改前运行源码（还原本次仅有的两个运行源码变更）在全新同构数据库中对照重跑，同样 10 通过、2 失败，失败名称与断言一致，未新增回退。两个失败分别是每日指引生成预期 202 实际 409、影子结算预期 available=0 不符；尚未根治该基线问题。容器日志保留在服务器该目录，仅摘录无敏感信息的结果。

## 公网基线与发布

部署前版本：`/opt/satori-test/releases/de6cb5f`，API/Worker 运行正常，ready 返回 ok。

公网基线 31 项通过：主页、bootstrap、独立测试账号登录、目录详情、会员目录、权益/订单/会员/退款查询、创建报价，以及各写接口的未登录和非法参数拒绝。本轮公网检查未创建支付订单或发起真实支付。

2026-09-06 11:55（Asia/Shanghai）发布完成：

- 后端提交：`629945dde65e6a840ad00a500d509495e83e30e9`，已推送并核对远端 `release/r1.1`。
- 服务器先从原 origin 拉取，再从新增量 bundle 执行 `pull --ff-only` 到候选提交；确认包含运行版本 `de6cb5f`，没有版本回退或冲突。
- `/opt/satori-test/current` → `/opt/satori-test/releases/629945d`。
- Compose 构建、迁移、种子迁移与 Seed 启动链成功；ready 返回 ok，API healthy、Worker running，二者重启数均为 0。
- API/Worker 镜像：`sha256:a00417f230963e0fc2e2786b518e0b879bb231ec62fc58bce8e74cd8d4dd555a`。
- 环境备份：`/opt/satori-test/backups/retire-r11-629945d/backend.env.production`，权限 600。旧发布目录 `de6cb5f` 保留。
- 新配置恰好删除六行阶段开关，逐字比较其他配置完全相同；运行 API 容器中历史变量数量为 0。
- 前端仍为 `7507ef7`，本次未发布前端。
- 部署后沿用部署前同一登录会话，29 项公网检查全部通过；与部署前 31 项去掉首次登录两步后的结果逐项完全一致（HTTP 状态和错误码）。覆盖目录、详情、会员、权益、订单、退款查询、实际报价及所有受影响写入口的鉴权/非法参数拒绝。

结论：在本次覆盖范围内未发现新增功能回退。真实微信支付/退款、Aqua 输出质量和移动端视觉未在本次重新验收；两项既有 E2E 失败和两处既有 lint 问题仍需独立处理。

若需回滚，恢复 `de6cb5f` 发布目录与配套环境，按部署文档重建运行服务；不需要数据库降级。不要把已删除配置重新写入新版本以尝试停单。
