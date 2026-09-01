# 巴拉丁（Balading）完整安装指南 —— 给 Agent / 部署者的分步手册

> 本文面向**能够执行命令的 Agent 或运维人员**：按步骤做完即可让手机连上主电脑的 DSH。
> 全流程约 30~60 分钟。每一步都给了「做什么 / 命令 / 预期结果 / 验证」，请逐步执行、逐步验证，不要跳过。

---

## 0. 架构与原理（先看懂再动手）

```
手机浏览器 (PWA) / Android App (APK WebView)
   │  https://m.yourdomain.com          （或 http://VPS_IP:8788 直连，仅测试）
   ▼
VPS nginx :443 (TLS 终结) ── SNI 分流 ──► 127.0.0.1:8445 ──► 网关 :8788
   ▼
巴拉丁认证网关 (server/index.mjs, systemd)
   │  ① 设备绑定（一次性令牌/万能码）→ 签发 HMAC-JWT Cookie（30 天）
   │  ② 校验 Cookie 后反代 /api/* → DSH_TARGET
   │  ③ /api/events.mux WebSocket 升级透传
   ▼
frp 隧道（VPS frps :7000 ← 主电脑 frpc 主动长连接，映射 VPS 127.0.0.1:7080 → 主电脑 127.0.0.1:3080）
   ▼
主电脑 DSH (127.0.0.1:3080)  ← 真正的数据源 / AI 执行
```

**关键点**：主电脑在 NAT 后面，手机永远不能直连主电脑；必须由主电脑**主动**经 frp 连到 VPS，VPS 作为中转。所有业务请求从手机 → VPS → frp → 主电脑 DSH。

---

## 1. 硬性前提（缺一不可，先检查再继续）

| # | 前提 | 说明 | 没有它会怎样 |
|---|---|---|---|
| 1 | **一台海外云服务器（VPS）** | 公网 IP，Ubuntu 22.04/24.04，1C1G 起步（网关是零依赖 Node，很轻） | 没有中转点，手机无法访问 |
| 2 | **一个域名（强烈推荐）** | 解析到 VPS IP；HTTPS 证书用 Let's Encrypt 免费签发 | 无域名可用 \`http://VPS_IP:8788\` 直连，但**不能**跨源绑定 Cookie（SameSite=None 要求 HTTPS），仅 PWA 同源场景可用 |
| 3 | **主电脑可运行 DSH** | Windows/Linux 均可，DSH 监听 127.0.0.1:3080 | 无数据源 |
| 4 | **主电脑能访问公网** | frpc 需要主动连接 VPS 的 frps 端口（默认 7000，可自定义） | 隧道建立不了 |
| 5 | **手机能访问 VPS** | 手机网络能到达 VPS 的 443（或 8788） | 无 |

> ⚠️ 本项目的「中转服务」= VPS 上的 **frps + 巴拉丁网关 + nginx**。三者缺一不可。

---

## 2. VPS 准备

### 2.1 选购
- 推荐：Vultr / DigitalOcean / Hetzner 的**东京 / 新加坡 / 香港**节点（国内访问快）。
- 最低配 1C1G；系统选 **Ubuntu 24.04**。
- 记下 VPS 公网 IP，本文用 \`YOUR_VPS_IP\` 代替。

### 2.2 SSH 登录
```bash
ssh root@YOUR_VPS_IP
# 若用非 root 用户，后续命令前面加 sudo
```

### 2.3 基础环境
```bash
# Node.js 20+（网关要求）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v   # 预期 v20.x

# nginx（HTTPS + 反代）
apt-get install -y nginx certbot python3-certbot-nginx
nginx -v  # 预期 nginx/1.2x
```

---

## 3. 域名与 DNS

1. 在注册商（Cloudflare / Namecheap / Porkbun…）买域名。
2. 添加 A 记录：\`m\` 子域 → \`YOUR_VPS_IP\`（TTL 默认即可）。
3. 等 1~5 分钟，验证：
```bash
dig +short m.yourdomain.com   # 预期输出 YOUR_VPS_IP
```

---

## 4. 部署巴拉丁网关

### 4.1 上传代码
```bash
# 在本机（有代码的地方）：
scp -r balading-before ubuntu@YOUR_VPS_IP:/opt/balading
# 或直接在 VPS 上：
git clone <你的私有仓库> /opt/balading
```
> 只需 \`server/\`、\`web/\`、\`deploy/\` 三个目录即可，不需要 android/（那是打包 APK 用的）。

### 4.2 构建前端
```bash
cd /opt/balading/web
npm install
npm run build    # 预期：vite build 完成，生成 dist/
```

### 4.3 生成签名密钥并写环境变量
```bash
openssl rand -base64 32   # 复制输出，这就是 MOBILE_SIGNING_SECRET
```

### 4.4 配置 systemd 服务
```bash
cp /opt/balading/deploy/balading-gateway.service.example /etc/systemd/system/dsh-mobile.service
nano /etc/systemd/system/dsh-mobile.service
```
把 \`MOBILE_SIGNING_SECRET=CHANGE_ME\` 替换为 4.3 生成的密钥。其他环境变量按需：

| 变量 | 默认 | 说明 |
|---|---|---|
| \`DSH_TARGET\` | \`http://127.0.0.1:7080\` | frp 隧道入口（VPS 本机），**不要改** |
| \`MOBILE_PORT\` | \`8788\` | 网关监听端口 |
| \`MOBILE_HOST\` | \`127.0.0.1\` | 只监听本机，由 nginx 反代（安全） |
| \`MOBILE_SIGNING_SECRET\` | 必填 | 签名密钥，**必须改成强随机** |
| \`MOBILE_BIND_CODE\` | 可选 | 万能授权码；不填则每次启动随机生成（看日志） |
| \`MOBILE_SESSION_TTL\` | 2592000 | 设备会话秒数，默认 30 天 |

### 4.5 启动网关
```bash
systemctl daemon-reload
systemctl enable --now dsh-mobile
systemctl status dsh-mobile        # 预期 active (running)
curl -s http://127.0.0.1:8788/api/link/gateway
# 预期 {"ok":true,"value":{"t":<时间戳>}}
journalctl -u dsh-mobile -n 20     # 看启动日志（含万能码）
```

---

## 5. nginx + HTTPS

### 5.1 站点配置
```bash
cp /opt/balading/deploy/nginx-mobile-tls.conf.example /etc/nginx/sites-available/m.yourdomain.com.conf
nano /etc/nginx/sites-available/m.yourdomain.com.conf
```
把 \`server_name m.example.com\` 改成 \`m.yourdomain.com\`；\`ssl_certificate\` 两行先不管（certbot 会自动填）：
```nginx
server {
    listen 127.0.0.1:8445 ssl http2;   # 内部端口，外面只有 443
    server_name m.yourdomain.com;
    # ssl_certificate 由 certbot 自动写入
    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # WebSocket 必需
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;                          # SSE 流式必需
    }
}
```
```bash
ln -s /etc/nginx/sites-available/m.yourdomain.com.conf /etc/nginx/sites-enabled/
```

### 5.2 签发 HTTPS（certbot 全自动）
```bash
certbot --nginx -d m.yourdomain.com
# 按提示选 redirect（自动 301）
nginx -t && nginx -s reload
```

### 5.3 验证 HTTPS
```bash
curl -sI https://m.yourdomain.com/ | head -5
# 预期 HTTP/2 200 + cache-control: no-cache
```

---

## 6. frp 隧道（核心中转）

> frp 让 VPS 能访问主电脑：主电脑 frpc 主动连 VPS frps，VPS 上的 127.0.0.1:7080 就映射到主电脑的 127.0.0.1:3080。

### 6.1 VPS 端：frps
```bash
# 下载 frp（架构按 VPS 选 amd64/arm64）
cd /tmp
wget https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_linux_amd64.tar.gz
tar xzf frp_0.61.1_linux_amd64.tar.gz
cp frp_0.61.1_linux_amd64/frps /usr/local/bin/
mkdir -p /etc/frp
```
\`/etc/frp/frps.toml\`：
```toml
bindPort = 7000                # 主电脑 frpc 连这个端口
auth.method = "token"
auth.token = "CHANGE_ME_frp_token"   # 换成强随机：openssl rand -hex 16
```
systemd：\`/etc/systemd/system/frps.service\`：
```ini
[Unit]
Description=frp server
After=network.target

[Service]
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload && systemctl enable --now frps
# 防火墙放行 7000（frp 控制端口）
ufw allow 7000/tcp
```

### 6.2 主电脑端：frpc
```bash
# 下载 Windows 版 frp（frpc.exe）
# https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_windows_amd64.zip
```
\`frpc.toml\`（主电脑上）：
```toml
serverAddr = "YOUR_VPS_IP"
serverPort = 7000
auth.method = "token"
auth.token = "CHANGE_ME_frp_token"     # 与 frps 相同

[[proxies]]
name = "dsh"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3080                        # 主电脑 DSH 端口
remotePort = 7080                       # 映射到 VPS 的 127.0.0.1:7080

# 可选：图片服务隧道（若主电脑有 8791 图片服务）
[[proxies]]
name = "dsh-img"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8791
remotePort = 8792
```
```bash
frpc.exe -c frpc.toml
# 建议做成开机自启（计划任务 / NSSM 服务）
```

### 6.3 验证隧道
```bash
# 在 VPS 上执行：
curl -s http://127.0.0.1:7080/ -o /dev/null -w "%{http_code}\n"
# 预期 200（说明隧道通了，VPS 能访问主电脑 DSH）
```

---

## 7. 主电脑 DSH 启动

```bash
dsh web --trusted-host m.yourdomain.com
```
> \`--trusted-host\` 必须包含你的域名，否则网关经 frp 转发过来的 WebSocket 会被 DSH 的 fence 拒绝。
> 本机验证：\`curl -s http://127.0.0.1:3080/ -o /dev/null -w "%{http_code}\n"\` → 200。

---

## 8. 手机接入（PWA 或 APK）

### 方式 A：PWA（推荐先测）
手机浏览器打开 \`https://m.yourdomain.com\`：
1. 同源场景自动跳过服务器绑定页。
2. 输入授权码（\`--gen-token\` 生成的一次性令牌，或万能码）→ 绑定成功。

### 方式 B：Android APK
1. 构建 APK（见 P2-BUILD.md）或使用已构建的 release APK。
2. 安装后首次打开 → **输入服务器地址**：\`m.yourdomain.com\`（或 \`YOUR_VPS_IP:8788\` 测试）→ 点「连接并进入」。
3. 输入授权码绑定。

### 生成一次性授权令牌（每次绑定用）
```bash
cd /opt/balading/server && node index.mjs --gen-token
# 输出：生成的一次性令牌: mob-xxxxx（用后即焚，仅可用一次）
```

---

## 9. 验收清单（全部通过才算部署成功）

| # | 检查 | 命令 / 操作 | 预期 |
|---|---|---|---|
| 1 | 网关活 | \`curl -s http://127.0.0.1:8788/api/link/gateway\` | \`{"ok":true,...}\` |
| 2 | HTTPS 活 | \`curl -sI https://m.yourdomain.com/\` | HTTP/2 200 |
| 3 | 隧道通 | VPS 上 \`curl -s http://127.0.0.1:7080/ -o /dev/null -w "%{http_code}"\` | 200 |
| 4 | 授权码有效 | 手机输错码 → 提示「授权码无效」；输对 → 绑定成功 | 行为正确 |
| 5 | 会话列表 | 绑定后首页出现会话列表 | 有数据 |
| 6 | 聊天 | 发一条消息，AI 回复 | 流式正常 |
| 7 | 实时事件 | 消息期间顶部「思考中」状态跟随 | 正常 |
| 8 | 重启存活 | \`systemctl restart dsh-mobile\` 后手机重开 App | 仍可用 |

---

## 10. 常见故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| 手机打开白屏 | 前端未构建 / nginx 没指对 | VPS 上 \`cd /opt/balading/web && npm run build\`；\`nginx -t\` |
| 绑定提示「授权码无效」 | 令牌用过了 / 输错 | 重新 \`--gen-token\`；确认万能码与 \`MOBILE_BIND_CODE\` 一致 |
| 绑定后列表空 / 502 | frp 隧道断 | 主电脑检查 \`frpc.exe\` 进程；VPS \`curl 127.0.0.1:7080\` |
| WebSocket 连不上 | \`--trusted-host\` 缺域名 | DSH 启动加 \`--trusted-host m.yourdomain.com\` |
| 手机能开但登录态丢 | 网关密钥变了 | 换密钥后所有设备 Cookie 失效，需重新绑定（正常） |
| 跨源绑定失败（APK） | 证书不是 HTTPS / SameSite | 必须用 HTTPS 域名；\`http://IP:8788\` 只适合 PWA 同源测试 |

---

## 11. 安全清单（上线前必读）

- [ ] \`MOBILE_SIGNING_SECRET\` 是强随机值，且**只存在于 systemd 环境变量**，不在任何代码/文档里
- [ ] frp token 是强随机值（\`openssl rand -hex 16\`）
- [ ] 网关只监听 \`127.0.0.1:8788\`，公网只能走 nginx 443
- [ ] VPS 防火墙只开 22 / 443 / 7000（frp），其他全关
- [ ] 设备会话默认 30 天；建议绑定后立即设置设备密码（App 内引导）
- [ ] 万能码 \`MOBILE_BIND_CODE\` 用强随机；不用了就删掉该环境变量
- [ ] 不要把 \`server/.secret\`、\`server/tokens.json\`、systemd 服务文件提交到任何公共仓库
