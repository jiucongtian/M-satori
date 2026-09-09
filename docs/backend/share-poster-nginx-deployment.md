# 分享海报上传：Nginx 部署检查

## 固定要求

手机浏览器的兼容保存流程先向 `POST /api/v1/share-posters` 上传 JPEG/base64，再展示可长按保存的图片。请求可能超过站点默认的 256KB，因此该接口必须单独设置 `client_max_body_size 2m`。部署代码不会自动同步服务器上的 Nginx 配置。

| 环境 | 站点配置入口 | 海报接口限制 | 代理目标 |
| --- | --- | --- | --- |
| 测试 | `/etc/nginx/sites-enabled/test-satori.shenxinyou.com.conf` | `2m` | `http://127.0.0.1:3200` |
| 生产 | `/etc/nginx/sites-enabled/fresh.shenxinyou.com.conf` | `2m` | `http://satori_live_api` |

生产配置入口实际指向 `/opt/satori/deploy/fresh.shenxinyou.com.conf`。发布前用 `readlink -f` 重新确认。不得把测试环境代理端口直接复制到生产，也不得以全站放宽替代接口特例。

生产配置应包含下列路由。保留与通用 API 路由一致的维护开关、请求头及代理行为：

```nginx
location ^~ /api/v1/share-posters {
    client_max_body_size 2m;
    if (-f /opt/satori/deploy/release1.maintenance) { return 503; }
    proxy_pass http://satori_live_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

站点通用 `client_max_body_size 256k` 保留。Nginx 的 2MB 是入口上限，不代表后端接受任意 2MB 图片；后端请求体解析、DTO 和图片大小校验仍独立生效。

## 发布和验证步骤

1. 检查 `nginx -T` 的实际站点和路由配置，包括继承关系；生成或覆盖站点配置的脚本也必须保留海报接口特例。
2. 修改前备份实际配置文件，记录路径；生产变更须获得用户明确授权。
3. 修改后执行 `nginx -t`，通过后 `systemctl reload nginx`；失败时恢复备份并重新校验。
4. 经目标域名的 HTTPS 站点验证以下边界，可在服务器通过本地连接和目标 Host 请求同一站点：
   - 海报接口发送 307,200 字节的无效 JSON、不带登录凭据：应到达后端并返回 400，而不是 Nginx 413。
   - 海报接口发送 2,097,153 字节：应返回 Nginx 413。
   - 普通 API 接口发送 307,200 字节：仍应返回 Nginx 413。
   - `/`、`/login`、`/api/v1/app/bootstrap`、`/api/v1/health/ready` 均应返回 200。
5. 无效 JSON 探针仅验证入口，不创建业务数据。最终由登录用户在手机/微信内逐张保存三种海报，验证长按保存流程；不能将入口检查等同于相册端到端验收。

## 2026-09-09 生产修复记录

- 生产主机：`159.75.73.193`；入口：`fresh.shenxinyou.com`，同站点兼容域名 `www.shenxinyou.com`。
- 原因：测试已有海报接口 2MB 特例，生产遗漏，继承 256KB 限制。生产日志发现 12 条海报请求体超限记录，大小包括 263,131、263,939、307,200 字节。
- 已在用户授权后增加上述海报路由，保留原生产代理、维护开关及其他接口限制。仅修改 Nginx，无应用发布、数据库迁移或服务版本切换；生产前后端版本均为 `5b2262c`。
- 备份：`/opt/satori/backups/share-poster-nginx-20260909T070059Z/fresh.shenxinyou.com.conf`。
- `nginx -t` 通过，平滑重载成功；上述三个请求体边界检查依次返回 400、413、413，四个页面/健康接口均返回 200。
- 手机实际保存到相册尚待用户复验。
- 回滚：将该备份恢复至 `/opt/satori/deploy/fresh.shenxinyou.com.conf`，执行 `nginx -t` 后平滑重载；回滚会重新引入海报上传 256KB 限制。
