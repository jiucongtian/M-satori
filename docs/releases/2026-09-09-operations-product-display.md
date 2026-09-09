# 测试后台商品发布状态与展示入口

- 用户授权：拆分发布状态、展示入口；补充次数不足时补购设置项及说明。只部署测试服务器，禁止访问生产服务器。
- 应用提交：`9f96f17468dd9ece99cc38c10a40392463b3f495`，已推送 `origin/release/r1.1` 并核验远端。
- 服务器：仅通过 `zh-tencent-openClaw` 访问测试服务器。
- 部署前：测试仓库先执行 pull，再从本次增量 bundle 快进至应用提交，无冲突。测试用户端及核心 API 容器未发布。
- 独立运营后台：`/opt/satori-test/releases/9f96f17-operations`；`/opt/satori-test/operations-current` 指向该目录。Compose 服务为 `satori-operations-api-1`、`satori-operations-web-1`，均 healthy。

## 功能与验证

- 列表分别显示当前版本的发布状态和展示入口；草稿中的入口不会被当作当前版本入口。
- 编辑器新增“展示入口”，普通商城与次数不足时补购可多选或全部关闭。会员显示固定会员计划页入口。
- 审核通过后新版本合并 `purchase_limit.displayChannels`，保留 lifetime、audience 等其他字段；旧草稿省略该字段时保持原入口。
- 本地后端测试 46/46、前端结构检查 32/32 通过；前后端构建通过。
- 浏览器检查使用本机 Chrome（项目指定 Chromium 未安装）：11 项中 10 项通过；新商品入口用例及三类商品配置/预览用例均通过。用户查询旧用例因 fixture 只含 phone_masked、当前页面读取 phone 而失败，该逻辑不在本次修改范围。
- 新界面的浏览器截图已人工核对：展示当前入口、可编辑的待发布入口及审核生效说明，无遮挡。
- 服务器真实 API 测试通过：草稿隔离、审核说明、入口持久化、限购保留、历史版本不可变、旧草稿兼容、关闭全部入口。
- 验证商品 ID：`a596463f-a26c-4de9-bf31-8844f9a6da56`。创建时为停用状态，测试期间不提供购买，完成后通过审核流程归档；保留审计记录。
- 校验脚本要求环境为 test（与服务端默认值一致），且 CORS 精确包含测试后台域名，避免误在其他环境运行；不会输出任何令牌或密钥。

## 访问与限制

- `http://operations.test.shenxinyou.com/admin`：HTTP 200。
- 本地运营 API `/health/ready`：ready；测试后台 Nginx vhost：HTTP 200。
- `https://test-satori.shenxinyou.com/` 与 `/api/v1/app/bootstrap`：HTTP 200。
- 测试运营后台 HTTPS 当前为自签名证书，标准 TLS 校验失败。本次未修改证书或 Nginx；不能将 HTTP 验证描述为 HTTPS 已通过。
- 本次未修改用户端补购触发逻辑，也未声称完成用户端补购弹窗验收。没有访问或修改生产服务器。

## 回退

原后台版本路径 `/opt/satori-operations/releases/f976206` 已保留。原镜像分别保留为 `satori-operations-api:before-9f96f17` 和 `satori-operations-web:before-9f96f17`。必要时用这两个镜像重建同名测试运营服务；无数据库迁移和降级操作。
