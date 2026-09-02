# 研发与发布 SOP

## 日常需求或 Issue

1. 明确 Issue、目标 Release、负责人、验收口径与涉及页面。
2. 判断是否影响视觉/组件/字体规范、前后端契约和原型；有影响先同步相应文档。
3. 拉取目标分支最新前后端代码，比较差异后实施修改。
4. 为本次功能补充或更新同编号测试用例，只运行定向测试及直接关联测试。
5. 提交前再次确认远端没有新提交；仅暂存本次变更，提交并推送目标 Release 分支。
6. 如用户要求部署，构建并发布测试环境，记录部署 Commit 与验证结果。

## 打 Tag 或全量回归

1. 锁定目标 Release 与候选 Commit，确认无未合并的高优先级阻塞项。
2. 执行该 Release 的完整前端、后端、契约、Lint、构建和自动化回归。
3. 汇总用例总数、通过/失败/待自动化数量、失败原因、覆盖范围及构建产物。
4. 通过 Release Gate 后才可打 Tag；Tag 必须指向已验证的 Commit。
5. 部署后记录环境、镜像/构建版本、时间、操作者和冒烟验证结果。

## 不在每次日常修改中执行

- 跨 Release 的全量回归。
- 与本次改动无直接关系的手工回归。
- 未经用户授权的生产部署或服务器数据删除。

## GitHub 网络异常处理

1. `git fetch`、`git pull` 或 `git push` 出现连接超时、HTTP/2 framing error、empty reply 时，先区分浏览器与终端链路，不反复盲目重试。
2. 当前研发机的 Clash Verge（`verge-mihomo`）本地代理为 `http://127.0.0.1:7897`；先用下列命令验证代理端口和 GitHub 连通性：

   ```bash
   curl -I --connect-timeout 10 --proxy http://127.0.0.1:7897 https://github.com
   ```

3. Git 采用仅对 `github.com` 生效的代理配置，避免影响内网、测试服务器及其他终端请求：

   ```bash
   git config --global http.https://github.com.proxy http://127.0.0.1:7897
   git config --global http.https://github.com.version HTTP/1.1
   ```

4. `gh` 或临时 `curl` 仍然直连失败时，只对当前命令增加 `HTTPS_PROXY=http://127.0.0.1:7897`，不默认把全部终端流量永久代理。
5. 如果 Clash Verge 未启动或端口变化，应先恢复代理服务或更新端口；不要绕过“提交前拉取、远端差异确认、推送成功后部署”的发布门禁。
