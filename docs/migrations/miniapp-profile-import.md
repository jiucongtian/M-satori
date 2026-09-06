# 连山易小程序用户档案与牌库迁移

本工具保留 `users`、`profiles` 原始导出，将经过核验、补齐出生资料的有效档案导入 Satori 原有档案体系。小程序的牌库是 `profiles` 列表，四柱及卡牌来源于 `baziData`。

**2026-09-07 确认的迁移规则：所有小程序档案均作为 Satori「生命智慧档案库」中添加的其他人物档案（`OTHER`），关系统一为「朋友」（`FRIEND`）。这是迁移默认分类，不代表根据名称推断真实关系。原名称完整保留，即使名称为“我自己”“本人”“爸爸”也不例外；不创建、选择或替换账号的本人主档案。用户之后可通过 Satori 常规功能调整关系分类。**

不导入提问、抽卡历史、AI 解读、意见反馈、聊天、订单、会员、配额或管理员权限。不自动创建 Satori 账号，不按旧手机号合并账号，不修改数据库结构，不覆盖已有档案。现有 `audit_logs` 仅存迁移操作与哈希，不充当历史资料库。

## 交付范围与边界

- 支持 JSON 数组、`{"data": [...]}`、CloudBase 逐行 JSON（NDJSON）、BOM 和 Extended JSON 日期。
- 原始 `users` / `profiles` 全字段按记录保存在 AES-256-GCM 加密归档中，包括原始生日、备注、时间精度标记、原四柱卡牌、原创建和修改时间、未知扩展字段、已删除档案。归档保留这些字段不代表把用户权限等字段导入 Satori。
- 通过现有 `ProfileLibraryService`、`SelfProfileService`、`CardCatalogService` 写入新档案、新版本和四张卡牌；姓名和出生资料使用目标环境的 `FieldCipher` 加密。
- 本工具为离线运维脚本，尚不包含面向用户的认领、补全页面或历史原牌展示页面。备注及旧牌快照在独立加密归档中；Satori 页面使用按现有规则计算的新版本。
- 原始出生地缺失时不能正式导入，不填默认城市。不确定时间保持 `DATE_ONLY`；其他旧时分的真实精度由用户或人工核验，不能把旧时辰代表值自动当作精确分钟。
- 新旧四柱不同时需要 `acceptRecalculatedCards: true`。这代表已经核对并接受差异，不应用批量默认值代替用户确认。
- 已删除档案不恢复；孤立档案、身份冲突和非法字段进入隔离清单。必须先查明来源再重新准备经核验的数据，不能只为通过校验伪造归属。

## 运行环境

在 `backend` 目录执行，使用项目现有 Node.js 和依赖。`node --import tsx` 无需额外安装，也避免某些沙箱对 tsx CLI 本地通信管道的限制。

```sh
node --import tsx scripts/import-miniapp.ts --help
```

## 1. 准备加密归档（不连接数据库）

```sh
node --import tsx scripts/import-miniapp.ts prepare \
  --users /absolute/path/users.json \
  --profiles /absolute/path/profiles.json \
  --namespace lianshanyi-miniapp \
  --out /absolute/private/path/new-batch
```

输出目录的父目录应存在，批次目录必须尚不存在，以避免覆盖备份。`namespace` 是固定的源小程序标识，后续增量批次应沿用同一值，不能按日期随意更换。不同云环境或不同小程序应使用不同来源标识。

输出：

| 文件 | 内容 |
| --- | --- |
| `source.encrypted.json` | 加密原始记录与校验哈希 |
| `archive.key` | 归档解密密钥，不是 Satori 数据库加密密钥 |
| `report.json` | 不含姓名、手机号、生日的数量与异常统计 |
| `review.encrypted.json` | 加密的逐档案校验结果 |
| `mapping.template.json` | 空映射模板，避免默认认领或补全 |

目录权限为 0700，文件为 0600。真实导出、归档、解密文件、映射和密钥不得提交 Git。归档与密钥应分别纳入受控备份；丢失密钥无法解密。

## 2. 全量离线验证

```sh
node --import tsx scripts/import-miniapp.ts verify \
  --archive /absolute/private/path/new-batch/source.encrypted.json \
  --key /absolute/private/path/new-batch/archive.key \
  --out /absolute/private/path/new-batch/validation.json
```

逐份验证所有基础校验合格的档案，检查出生日期、阴阳历、闰月、性别和原始字段未丢失，计算并统计新旧四柱差异。**为测试而在内存使用合成目标账号与统一测试地点，不连接数据库，不验证真实账号，不输出可执行账号映射。** `calculatedProfiles` 不是已导入数量，`importedProfiles` 为 0。

## 3. 核验账号和出生资料

需要查看原始资料时解密到私有目录：

```sh
node --import tsx scripts/import-miniapp.ts review \
  --archive /absolute/private/path/new-batch/source.encrypted.json \
  --key /absolute/private/path/new-batch/archive.key \
  --out /absolute/private/path/new-batch/review.private.json
```

由可信的认领流程或人工核验填写映射 JSON。下面仅为格式示例，不是用户的真实账号：

```json
{
  "version": 1,
  "namespace": "lianshanyi-miniapp",
  "users": [
    {
      "sourceUserId": "旧 users._id",
      "targetUserId": "00000000-0000-4000-8000-000000000001",
      "verification": {
        "method": "MANUAL_REVIEW",
        "reference": "实际核验凭证编号"
      }
    }
  ],
  "profiles": [
    {
      "sourceProfileId": "旧 profiles._id",
      "subjectType": "OTHER",
      "relationshipType": "FRIEND",
      "locationId": "geonames:1816670",
      "timePrecision": "EXACT_MINUTE",
      "confirmed": true,
      "acceptRecalculatedCards": false
    }
  ]
}
```

- `verification.method` 支持 `MINIAPP_CLAIM`、`MANUAL_REVIEW`。脚本记录核验凭证的哈希，但不能替代账号所有权核验；只有完成双端认领或可靠人工核验后才能填写。
- `locationId` 必须来自 Satori 现有地点目录。示例地点仅说明格式，绝不能给真实用户默认填写。
- `subjectType` 只能为 `OTHER`，省略时自动填写 `OTHER`；`SELF` 会被拒绝。
- `relationshipType` 只能为 `FRIEND`，省略时自动填写 `FRIEND`。不需要逐个确认亲属、朋友等分类，也不允许通过旧映射改变此规则。使用旧版映射时，删除这两个字段以采用新默认值，或明确改成 `OTHER` / `FRIEND`；重新生成计划再核对。执行层也会拒绝绕过校验的本人档案或其他关系计划。
- `timePrecision` 支持 `EXACT_MINUTE`、`APPROXIMATE`、`HOUR_RANGE`、`DATE_ONLY`。`HOUR_RANGE` 还必须提供 `hourBranchCode`（如 `ZI`）；其他精度不能提供此字段。
- 姓名和生日从原记录带入，不截断长姓名，也不自动修正非法生日。同一来源多用户合并为一个目标账号不在本工具范围内。
- 未列入 `profiles` 的档案不会导入，仍留在原始归档；推荐先按 20–100 份小批次核验。

## 4. 生成可核对的导入计划

```sh
node --import tsx scripts/import-miniapp.ts plan \
  --archive /absolute/private/path/new-batch/source.encrypted.json \
  --key /absolute/private/path/new-batch/archive.key \
  --mapping /absolute/private/path/reviewed-mapping.json \
  --out /absolute/private/path/plan.private.json
```

计划包含原始记录、转换后的出生输入、目标用户、地点、新算法快照及新旧四柱差异。此文件含个人资料，应妥善保管。正式导入会从归档和映射重新生成计划，不直接执行被修改的计划文件。

## 5. 数据库模拟导入与正式写入

由目标环境的安全配置提供三个变量，不将生产密钥写入命令历史或文档：

- `MINIAPP_TARGET_DATABASE_URL`：必须显式指定，不自动沿用 `DATABASE_URL` 或开发默认值。
- `DATA_ENCRYPTION_KEY`：必须与目标 Satori 环境的现有加密密钥一致。
- `CURSOR_SIGNING_SECRET`：目标环境现有值。

默认执行完整导入事务后回滚：

```sh
node --import tsx scripts/import-miniapp.ts apply \
  --archive /absolute/private/path/new-batch/source.encrypted.json \
  --key /absolute/private/path/new-batch/archive.key \
  --mapping /absolute/private/path/reviewed-mapping.json \
  --report /absolute/private/path/dry-run.json
```

确认预演结果、目标库备份和映射后，使用新的报告文件，并增加 `--commit --confirm-database 实际数据库名` 才会提交。数据库必须已具备现行 Satori 表结构和完整的 60 张活动卡牌；工具不会替目标库执行建表、升级、种子初始化。

选中批次整体原子提交。任一档案失败时整批回滚；跨账号认领、软删除的既往导入或计划变化会阻断。目标账号已有本人档案不影响导入，主档案及其版本保持原样；没有本人档案也不会因本次导入而创建主档案。长期防重使用确定性的 `audit_logs` 标记，不依赖会过期的幂等缓存。同一批次重跑返回 `REPLAYED`，不会新增档案。已经使用旧规则导入的记录不会自动改分类，计划变化时应先人工核对，避免覆盖用户后续修改。

报告 `committed: false` 表示预演回滚；`committed: true` 表示已提交。若提交后文件写入失败，报告可能停留 `STARTED`、`committed: null`，此时不能假定回滚；用相同归档、来源标识和映射重新运行，从持久审计标记确认结果。目标档案后续由用户正常修改时，重跑只报告既往导入，不覆盖用户修改。

## 测试

```sh
npm run test:unit -- packages/modules/src/legacy-miniapp-import/source.spec.ts
MINIAPP_TEST_DATABASE_URL=postgresql://migration_test:local-test-only@127.0.0.1:55439/satori_miniapp_import_test \
  npm run test:integration -- tests/integration/miniapp-import.test.ts
npm run typecheck
```

集成测试仅允许名为 `satori_miniapp_import_test` 的本机专用空数据库，会初始化该临时库的现有迁移链与合成卡牌。测试容器可在测试结束后移除，不与业务数据库共享数据卷。

覆盖加密、日期格式、阴阳历与闰月、来源归属、已删除档案、不确定时间、四柱差异确认、数据库结构不变、现有数据不被覆盖、完整预演回滚、失败整批回滚、过期幂等缓存后的重跑、并发导入和重复认领。

## 2026-09-06 导出数据验收

- 用户 6,215 条，档案 11,217 条；完整原始记录已通过加密归档与读取校验。
- 有效档案 9,352 条：9,299 条基础校验通过；53 条因所属旧用户缺失隔离。
- 已删除档案 1,865 条，仅保存在归档中。其中还有 30 条所属旧用户缺失，不恢复。
- 共 83 条孤立档案中的 82 条能找到相同 openid 的其他用户记录，仅提示可能的旧用户 ID 变更，不自动重新归属。
- 16 组重复手机号，4,415 位用户没有手机号；不影响原始资料保留，也不作为自动合并依据。
- 对 9,299 条合格档案执行了全量离线计算，原始日期、阴阳历、闰月、性别、原四柱与备注均保留。测试使用合成账号和统一测试地点，不能解释为这些用户已认领或出生地已确认。
- 模拟计算存在 362 份新旧四柱差异：285 份标记为时辰不确定，77 份没有该标记；按柱统计年柱 2、月柱 17、日柱 40、时柱 355（同一档案可多柱不同）。这些数据需要核对并接受差异后才可导入新版本，原结果仍在归档中。
- 10 项迁移规则单元测试、10 项专用 PostgreSQL 集成测试通过；另有 8 项现有计算器/地点目录关联测试通过。
- PostgreSQL 集成测试包含 53 份真实导出样本及其 212 条卡牌绑定；验证了默认完整回滚、提交后解密生日一致、原结构不变和重跑不重复。样本使用临时合成账号及测试地点，未写入业务库。
- 实际 CLI 的 prepare、plan、apply 预演、apply 提交和再次执行均通过合成数据验证。
- TypeScript 类型检查、定向 ESLint、Prettier 和 Git 空白检查通过。真实导出、密钥及私有报告位于仓库外，未纳入版本控制。

目前已交付离线迁移脚本与测试。正式导入前仍需真实账号核验、出生地与时间精度确认，并处理隔离档案；档案类型和分类已固定，无需再确认哪份是本人。未部署认领页面，也未迁移任何线上用户。

## 2026-09-07 分类规则修正复测

- 移除迁移为本人主档案的分支，所有记录固定 `OTHER` / `FRIEND`；省略类型、分类时使用这两个默认值，其他值在计划和执行层均拒绝。
- 原始名称保留，不根据“我自己”“爸爸”等名称推断身份或关系；超过本人名称长度限制但满足人物档案限制的名称也可完整导入。
- 12 项迁移规则单元测试、11 项 PostgreSQL 集成测试通过；验证了已有主档案保持原样、没有主档案时不自动创建、错误计划不能绕过限制，以及失败整批回滚。
- 全量 9,299 份可处理档案的离线计划全部为其他人物／朋友。真实数据库样本 53 份／212 条卡牌绑定也按固定规则通过校验，测试账号和出生地均为临时模拟数据。
- TypeScript、定向 ESLint、Prettier 与 Git 空白检查通过。未修改表结构，未写入业务数据库。
