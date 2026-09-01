# 架构说明

## 部署形态（VPS 独立应用 + 主电脑数据源）

```
┌─ 主电脑（Windows）─────────────────────────────────┐
│  DSH 本体 (dsh web, 127.0.0.1:3080)                │
│    = 数据源 / 会话存储 / AI 执行 / 工具运行          │
│  frpc (隧道客户端, 开机自启 frpc-dsh.vbs)           │
└──────────────┬─────────────────────────────────────┘
               │ frp 隧道 (443 TLS, token 认证)
┌──────────────▼─────────────────────────────────────┐
│ 新 VPS (YOUR_VPS_IP)                            │
│  nginx stream 443 (SNI 分流)                       │
│    m.example.com → 127.0.0.1:8445 (TLS)       │
│  nginx http 8445 (nginx-mobile-tls.conf)       │
│    → proxy_pass 127.0.0.1:8788                     │
│  dsh-mobile 网关 (systemd, node index.mjs)         │
│    = 静态托管 dist + 设备认证 + 反代                │
│    DSH_TARGET=http://127.0.0.1:7080 (frp 入口)     │
│  frps (systemd) → 隧道映射 7080 → 主电脑 DSH 3080  │
└────────────────────────────────────────────────────┘
        ▲
        │ https://m.example.com
┌───────┴────────┐
│ 手机浏览器 / App│
└────────────────┘
```

## 关键角色

| 角色 | 位置 | 职责 |
|---|---|---|
| 主电脑 DSH | 3080 | 会话、消息、AI 推理、工具执行（数据唯一真源） |
| VPS 网关 | 8788 | 认证（设备绑定 Cookie）、静态托管、反代、WS 升级代理 |
| VPS nginx | 443/8445 | TLS 终结、SNI 分流、gzip |
| frp | 7080↔3080 | 内网穿透（VPS 回连主电脑） |
| 手机端 | — | React 前端（VPS 提供），仅消费 API |

## 数据流向

- **读**：手机 → nginx → 网关（校验 Cookie）→ frp → DSH → 返回
- **写**：session.prompt（mode queue/steer）→ 同上，DSH 执行
- **实时**：WebSocket /api/events.mux → 网关 upgrade 代理 → frp → DSH（全会话事件流，前端按 sessionId 分流）
- **附件**：session.attachment 返回原图 base64；前端压缩缩略图；SW 永久缓存（内容寻址）

## 后台通知与会话状态账本

```text
DSH session.list/history
  → VPS 每 5 秒对账
  → notification-state.json（状态、终态原因、设备已读游标、增量序号）
  ├→ React 快照：蓝点运行 / 绿点完成 / 红点异常 / 未读角标
  └→ Android KeepAliveService 长轮询：系统通知与 Launcher 角标
```

- DSH 的 `turn/end.data.reason.kind` 是终态真值：`completed` 为绿色；`aborted / blocked / error / max-tokens / interrupted` 为红色。
- 增量事件携带当时的不可变状态快照；Android 另按 `terminalKey` 去重，避免断线重放产生重复通知。
- 已读确认必须同时提交 `sessionId + terminalKey`，请求途中出现新终态时不会误标已读。
- 新设备首次接入会把既有历史建立为已读基线；后续终态才计入 App 未读角标。
- WebView 前台时保留页面音效；后台由原生服务接管。恢复前台后以 VPS snapshot 对账，不依赖本地 WebSocket 是否持续存活。
- 手机真正断网、用户强行停止 App、关闭通知权限，或主电脑/frp/DSH 离线时不能保证即时通知；恢复连接后按账本补齐。

## 高可用/自启

- 主电脑：frpc（frpc-dsh.vbs）、DSH（DSH-Tray.vbs + 计划任务）
- VPS：网关（systemd dsh-mobile）、frps（systemd frps）
- 手机端：Service Worker 缓存 → 离线可看已加载内容

## 缓存体系

| 层 | 内容 | 策略 |
|---|---|---|
| HTTP 头 | index.html | no-cache（保证拿新版） |
| HTTP 头 | /assets/* | immutable 一年 |
| Service Worker | 静态资源 | cache-first |
| Service Worker | session.list/history | stale-while-revalidate |
| Service Worker | session.attachment | 永久缓存（内容寻址） |
| 前端 localStorage | 会话列表快照 / 历史 / 标题 | 持久化，启动即渲染 |
