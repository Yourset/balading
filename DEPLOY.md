# dsh-mobile 公网部署方案（历史文档，已由 docs/DEPLOYMENT.md 取代）

> ⚠️ 本文为早期部署方案，部署请以 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 为准。

> 前置：本地 MVP 已验证通过 —— 设备绑定、会话列表、聊天历史渲染、mux 实时流（WS）均已跑通。
> 当前生产环境已迁移至新 VPS `YOUR_VPS_IP`；SSH 使用 `<ssh 别名>`，管理命令使用 `sudo`。

## 目标架构

```
手机浏览器
  │ https://m.example.com 或 dsh.example.com/m/
  ▼
新 VPS nginx (YOUR_VPS_IP)
  ├─ 静态资源 /m/ → 网关托管的前端 dist
  └─ /api/* 反向代理 → 本地网关 (127.0.0.1:8788)
  ▼
认证网关 (dsh-mobile/server，node)
  ├─ /api/auth/device-bind   一次性令牌 → 设备会话 Cookie
  └─ 其余 /api/* 校验后反代 → DSH
  ▼
DSH：VPS 上经 frp 隧道映射到本机 DSH 的端口
  （现有 frps 已把 127.0.0.1:7080 → 本机 frpc → 本机 DSH 3080）
  → 网关用 DSH_TARGET=http://127.0.0.1:7080
```

## 为什么网关反代到 127.0.0.1:7080

现有 frp 链路（来自 vps-credentials.txt）：
`本机 frpc(443 TLS) → VPS nginx stream(SNI) → frps(7000) → 127.0.0.1:7080 → 本机 DSH(3080)`

即 **VPS 本机的 127.0.0.1:7080 就是通往本机 DSH 的入口**。网关部署在 VPS 时设
`DSH_TARGET=http://127.0.0.1:7080`。网关转发时 `host=127.0.0.1:7080`（loopback），
DSH 信任 fence 视为 loopback 放行。**推测可行，部署前需先 curl 验证 `127.0.0.1:7080/api/session.list` 可达。**

## VPS 步骤（授权后执行）

1. 上传 `dsh-mobile/` 到 VPS（如 `/opt/dsh-mobile`），`web/dist` 预构建好。
2. 装 node20+：`apt install nodejs npm` 或 nvm。
3. systemd 启动网关（`/etc/systemd/system/dsh-mobile.service`）：
   ```ini
   [Unit] Description=dsh-mobile gateway After=network.target
   [Service] WorkingDirectory=/opt/dsh-mobile/server
   Environment=DSH_TARGET=http://127.0.0.1:7080
   Environment=MOBILE_SIGNING_SECRET=<强随机>
   ExecStart=/usr/bin/node index.mjs
   Restart=always User=root
   [Install] WantedBy=multi-user.target
   ```
   网关默认监听 127.0.0.1:8788（仅本机，暴露给 nginx）。
4. nginx 新增站点（`/etc/nginx/conf.d/m.balading.conf` 或并入现有 `sites-enabled/dsh.conf`）：
   ```nginx
   server {
     listen 443 ssl; server_name m.example.com;
     # SSL 证书沿用现有
     location / { proxy_pass http://127.0.0.1:8788; proxy_set_header Host $host; }
     location /api/ { proxy_pass http://127.0.0.1:8788; proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
       proxy_set_header Host $host; }
   }
   ```
   **关键**：`/api/` 必须带上 `proxy_set_header Upgrade/Connection "upgrade"` 以支持 mux 的 WebSocket 透传。
5. 生成一次性令牌：`cd /opt/dsh-mobile/server && node index.mjs --gen-token`。

## 安全边界

- DSH 自身无认证；认证由网关 + nginx 承担。
- 一次性令牌：`node index.mjs --gen-token` 生成，用后即焚（含持久写回 tokens.json）。
- 设备会话：HMAC JWT（HttpOnly Cookie），默认 30 天，可在 `MOBILE_SESSION_TTL` 调整。
- 敏感操作（credentials/settings）建议网关层再加 PIN/生物识别二次确认（后续迭代）。

## 待确认 / 风险

1. **VPS 到本机 DSH 的 127.0.0.1:7080 是否真可达**（frp 现状需现场验证，授权后首做 curl 探测）。
2. nginx 现有 `sites-enabled/dsh.conf`（8443 auth_basic）与新增 /m 路由的**共存方式**：是新增子域 `m.example.com`（推荐，互不干扰）还是复用 dsh.example.com 加路径。
3. SSL：m.example.com 需要证书（沿用现有或 Let's Encrypt）。

## 需要您拍板
- 用**新子域 `m.example.com`**（推荐）还是 `dsh.example.com/m/` 路径？
- 是否本次就授权我 ssh 上 VPS 执行部署（我会先只读探测 7080/nginx，再逐步落）。