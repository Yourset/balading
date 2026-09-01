# 排障手册（Troubleshooting）

## 手机一直「旧版」（改了服务器不生效）

升级入口：**任意不存在的路径打开一次**（如 `https://m.example.com/x`）——旧 SW 对该路径网络优先，直接拿新版，新版自动完成 SW 升级与缓存清理。

根因链：
1. 旧 sw.js 响应曾带 `immutable` 缓存头 → 浏览器缓存后永不检查更新（清缓存/换浏览器才能破）；
2. SW install 预缓存页面时把旧页面写进新缓存 → 即使 SW 升级，主页仍是旧版。

已根治（2026-08-26）：
- 网关：sw.js / index.html 一律 no-cache；仅带 hash 资源 immutable。
- 前端：SW 注册 URL 带构建时间戳（`/sw.js?v=<ts>`）；`controllerchange` 自动刷新。
- SW v12：install 不预缓存页面；`/` 与 `/index.html` 网络优先 + 离线兜底；activate 清旧缓存。

排查线索：VPS nginx 日志看手机是否请求 `/sw.js?v=`（带时间戳 = 新版 JS 在跑）。

## 访问深层路径提示下载文件

- 网关 SPA fallback 曾把不存在路径返回 `content-type: application/octet-stream`（ext 取不到）。
- 已修复：fallback 时显式 `ext='.html'` → text/html。

## 手机打不开 / 黑屏

1. 确认主电脑 DSH 与 frpc 在跑（frpc-dsh.vbs 自启；DSH-Tray.vbs 自启）。
2. 手机**彻底刷新**（关标签重开 / 清缓存）——很多“旧版”问题是缓存。
3. 检查本机 JS 是否崩溃：浏览器 DevTools Console 有报错（如 useRef is not defined）。
4. 公网可达性：curl https://m.example.com/ 应 200。

## 502 Bad Gateway

- 链路：nginx → 网关(8788) → frp(7080) → DSH(3080)。哪一环断了都会 502。
- 排查：
  - 主电脑：`Get-Process frpc`、`curl http://127.0.0.1:3080/`
  - 新 VPS：`ssh ubuntu@YOUR_VPS_IP` → `curl http://127.0.0.1:7080/`、`sudo systemctl status dsh-mobile frps`
- 常见：frpc 重连窗口（自愈）；主电脑 DSH 挂。

## 会话串线（A 会话出现 B 内容）

- 根因：mux 事件帧 sessionId 在 **payload 层**（frame.sessionId），不在 event 内。
- 修复：ChatPage 过滤 `const sid = frame.sessionId || inner.sessionId || inner.data?.sessionId`。

## 图片不显示 / 显示为文本

- md 图片语法 `![alt](公网URL)` 需要**新版 JS**（含 md.jsx 图片支持）→ 刷新。
- 附件缩略图（ImageView）需已绑定设备 + 附件接口可达（SW 缓存后秒出）。
- 图片 URL 必须公网可访问（手机访问不了 127.0.0.1）。

## 工作区一直 pending / 实时流不更新

- 可能：DSH 启动参数缺 `--trusted-host m.example.com`，mux WS 被 fence 拒。
- 修：DSH 启动命令加 `--trusted-host m.example.com` 后重启。

## 私人助手停在工具调用 / 问题没有选项

- `ask_user_question` 不是普通 `tool/call` 历史卡片；真实交互来自 mux 的 `question/requested`。
- 移动端必须保留外层 `rpcId`，选择后调用 `POST /api/respond`；向 Composer 输入普通消息不会解除等待。
- 刷新后 DSH 会重放尚未回答的问题；收到 `question/resolved` 后问答卡应消失。

## 手机要求重新绑定

- 设备 Cookie 30 天有效；若 VPS 网关密钥变化（secret 变更）则全部失效。
- 修：VPS 上 `cd /opt/dsh-mobile/server && node index.mjs --gen-token` 生成新令牌，手机重新绑定。

## 加载慢

- 已优化：分页（maxMessages=15）、缓存（localStorage/SW）、gzip、immutable。
- 若仍慢：看顶部连接状态（延迟颜色）；检查主电脑 DSH 负载；考虑 P2P 直连（ROADMAP）。

## 安全

- `MOBILE_SIGNING_SECRET` 明文在 deploy/balading-gateway.service.example —— 建议换强随机只放 VPS 环境变量。
- server/.secret 与 tokens.json **不入库**（.gitignore 已排除）。
