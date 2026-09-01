# 生产部署指南

> 目标架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。部署前确认：主电脑 DSH 3080 + frpc 已就绪。
> 本文用 `YOUR_VPS_IP` / `m.yourdomain.com` 占位，替换为你自己的服务器与域名。

## 前置：一台海外 VPS（免备案）

- 服务器在境外（如 Vultr / DigitalOcean / Hetzner 的新加坡、东京或香港节点），**无需 ICP 备案**。
- 最低配置 1C1G 即可（网关是零依赖 Node 进程）。
- 域名在任意注册商购买后，把 A 记录指向 `YOUR_VPS_IP`（推荐用 Cloudflare DNS 托管，免费 CDN + 隐藏源站）。

## 主电脑侧（一次性）

1. DSH 本体：`dsh web --trusted-host m.yourdomain.com`（若手机 WS 异常，把域名加入 `--trusted-host`）。
2. frpc：`tools/frp/frpc.toml` 配置 `serverAddr=YOUR_VPS_IP`，frpc 开机自启（Windows 可用计划任务/VBS）。

## VPS 侧（一次性）

> SSH：`ssh ubuntu@YOUR_VPS_IP`（管理操作加 `sudo`）。

1. 上传 `dsh-mobile/` 到 `/opt/dsh-mobile`（server + web/dist）。
2. 生成强随机签名密钥：`openssl rand -base64 32`，填入 systemd 服务。
3. systemd：复制 `deploy/balading-gateway.service.example` 为 `/etc/systemd/system/dsh-mobile.service`，配置：
   - `DSH_TARGET=http://127.0.0.1:7080`（frp 隧道入口）
   - `MOBILE_SIGNING_SECRET=<上一步生成的强随机值>`
   - 可选 `MOBILE_BIND_CODE=<万能授权码>`（不配置则每次启动随机生成并打印在日志）
4. nginx：`deploy/nginx-mobile-tls.conf.example` 改名为你的域名并并入 sites-enabled（8445 → 8788）；`deploy/nginx-sni-frp.conf.example`（443 SNI 分流）。
5. HTTPS：certbot 自动签发 Let's Encrypt 证书（`certbot --nginx -d m.yourdomain.com`）。
6. 启动：`systemctl enable --now dsh-mobile frps`；`nginx -t && nginx -s reload`。
7. 生成绑定令牌：`cd /opt/dsh-mobile/server && node index.mjs --gen-token`（手机绑定页输入；或用万能授权码）。

## 更新前端（热更新）

```powershell
# 本机构建
cd dsh-mobile\web
npm.cmd run build
# 上传（网关读文件系统，无需重启）
scp -r dist ubuntu@YOUR_VPS_IP:/tmp/dsh-mobile-web-release
ssh ubuntu@YOUR_VPS_IP "sudo cp -a /tmp/dsh-mobile-web-release/. /opt/dsh-mobile/web/dist/"
```

### 短版本号规则

- 每次正式热部署前必须更新 `web/src/version.js`，格式为 `v月.日.当日序号`，例如 `v8.27.1`。
- 同一天继续发布时只递增最后一位；日期变化后从 `.1` 重新开始。
- 版本号会以小字显示在手机端顶部；交付回复必须明确写出本次已部署版本号。
- 部署后同时验证公网 `index.html` 引用的新 hash 脚本、脚本内版本号和 `sw.js`，避免手机仍停留在旧缓存。

## 更新网关脚本

```powershell
scp server/index.mjs ubuntu@YOUR_VPS_IP:/tmp/index.mjs
ssh ubuntu@YOUR_VPS_IP "sudo cp /tmp/index.mjs /opt/dsh-mobile/server/index.mjs && sudo systemctl restart dsh-mobile"
```

## 手机端接入（巴拉丁 App / PWA）

- **PWA**：手机浏览器直接打开 `https://m.yourdomain.com`，同源自动跳过服务器绑定页。
- **APK**：首次启动输入你的网关地址（`m.yourdomain.com` 或 `YOUR_VPS_IP:8788`），校验连通后即可绑定设备。
- 绑定：输入授权码（万能码或一次性令牌）→ 30 天会话，可设密码解锁。

## 验证

- `curl -sI https://m.yourdomain.com/` → 200 + `cache-control: no-cache`
- `curl -sI https://m.yourdomain.com/assets/<js>` → 200 + immutable
- 手机绑定后打开会话列表正常。
