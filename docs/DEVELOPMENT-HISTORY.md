# 开发历程（Development History）

> dsh-mobile 从想法到现在的完整迭代记录。按时间线整理，含每个阶段的功能与踩坑。

## 2026-08-17 · 前置：VPS 与 frp 隧道

- 最初使用一台旧 VPS（现已退役并迁往新 VPS）。
- 部署 frp：主电脑 frpc（开机自启 frpc-dsh.vbs）↔ VPS frps（systemd），把主电脑 DSH 3080 映射为 VPS 本机 127.0.0.1:7080。
- nginx SNI 分流：dsh.example.com(8443) / www.example.com(8444) / m.example.com(8445)。

## 2026-08-25 上午 · MVP：独立移动端 + 设备绑定

- 目标：不是把 DSH Web 塞进手机，而是基于 DSH /api 重做手机优先前端。
- 完成：React+Vite 前端（绑定/会话列表/聊天/任务/工作区/我的）+ 零依赖 Node 认证网关（一次性令牌绑定、HMAC-JWT Cookie、反代、静态托管、WS 升级代理）。
- 关键契约实测：RPC 信封、session.list/history、events.mux（WS）、projections.values.title。
- 本地 MVP 验证通过后部署到 VPS：nginx 8445 → 网关 8788 → DSH_TARGET=127.0.0.1:7080。

## 2026-08-25 下午 · 体验迭代（多轮）

### 移动适配与信息过滤
- 聊天页顶部显示会话标题（从 projections.values.title 取）。
- 思考过程（reasoning）默认折叠 → 后来完全隐藏；工具卡折叠、高度减半。
- 系统注入内容（system-reminder / 记忆摘要）在手机端隐藏。

### Markdown 与图片
- 自研轻量 md 渲染器（md.jsx，零依赖、防 XSS）：粗体/斜体/删除线/代码/列表/表格/引用/代码块/图片。
- 图片草稿：选图先预览（≤100KB 自动压缩），输入说明后一起发送。
- 消息图片查看：附件懒加载 → 缩略图（≤100KB）→ 点击全屏看原图；SW 永久缓存附件（内容寻址）。

### 交互与发送
- 发送模式 queue → steer（可打断当前生成，AI 重新回答）。
- 打开会话定位最底部；上翻记住位置；「回到底部」按钮；运行中底部跟随模式 + 思考小条。

### 性能与网络
- 卡点定位：不是带宽，是 DSH 生成 session.list 614ms + 无缓存 + 手机旧版 JS。
- 列表/历史缓存（sessionStorage → localStorage 持久化）+ 首屏分页（maxMessages=15 + beforeSeq 加载更早）。
- HTTP 缓存头：index.html no-cache、assets immutable。
- Service Worker：静态资源 cache-first、API SWR、附件永久缓存、离线兜底。
- mux WebSocket 断线自动重连（指数退避）。
- 顶部连接状态指示（每秒检测：≤500ms 绿 / >500ms 黄 / 断开红）。

### Android 壳
- Capacitor 骨架 + android/ 平台工程生成（WebView 壳，热更新 = 服务器部署）。

## 2026-08-26 · 底部 4 菜单 + 私人助手 + AI 绘画 + 自动更新

- 底部菜单 5→4：会话 / 私人助手 / 笔记 / AI绘画（任务、工作区、我的入口移除，解绑入口移入私人助手顶栏）。
- 私人助手：固定 mobile 预设会话 + 长期记忆（memory.md）自动同步 VPS /opt/ai-notes；换设备自动找回原会话。
- AI 绘画：固定绘画会话 + 快捷提示词 chips；出图走主电脑 DSH imagegen。
- 图片显示链路：本机 8791 → frp 8792 隧道 → VPS 网关 /img/ 代理 → 前端 URL 重写。
- 自动更新机制根治：sw.js no-cache + SW 注册带构建时间戳 + controllerchange 自动刷新 + SW v12（页面网络优先、不预缓存旧页、activate 清旧缓存）。
- 存量设备升级入口：访问任意不存在路径（如 /x）绕过主页缓存拿新版。
- 完整方案见 [MOBILE-OPTIMIZATION-2026-08-26.md](MOBILE-OPTIMIZATION-2026-08-26.md)。

## 2026-08-26 · 新 VPS 全量迁移

- 生产 VPS 统一切换到 `YOUR_VPS_IP`，本机 `frpc` 已建立 `443` 长连接，代理 `7080 → DSH 3080` 与 `8792 → 图片服务 8791`。
- 旧 VPS 的 `/opt/dsh-mobile`、`/opt/ai-notes`、nginx、systemd 与 frps 配置已打包归档到新 VPS `/opt/migration-from-old-vps/`；迁移前的新 VPS 状态另存 `/opt/migration-backups/`。
- `ai-notes` 与私人助手 `memory.md` 已迁至新 VPS，电脑端 `note-sync.mjs` 改用 SSH 别名（`~/.ssh/config` 中配置），不再自动删除远端文件。
- SSH 管理账号改为 `ubuntu` + `sudo`；部署文档、排障命令与凭据说明统一更新。
- 私人助手卡住根因确认为移动端丢失 `question/requested` 的 `rpcId`；现已保留完整 mux 信封、增加问答卡与 `/api/respond` 回传，不能用普通 `session.prompt` 代替。
- 端到端绑定测试发现运行中的网关不会看到 CLI 新增令牌；`device-bind` 现会先重载 `tokens.json`，无需为生成令牌重启服务。
- 新 VPS 认证问答链路已做独立自动验收：两次实时令牌绑定均为 200、`auth/me` 为 200、公网 `/api/respond` 返回 `{accepted:true}`；电脑端持久化到对应 `tool/result`，结构化答案命中且最终产生 `turn/end`。

## 踩坑记录（重要教训）

| 坑 | 根因 | 修复 |
|---|---|---|
| 手机全黑屏 | App.jsx 用了 useRef 但 import 漏了 → 绑定后渲染 Shell 崩溃 | 补 import；教训：每次改动必须本地浏览器验证再部署 |
| 跨会话串线 | mux 事件帧的 sessionId 在 payload 层，前端从 event 内找 → 过滤失效，所有会话事件涌入 | sessionId 取位改为 frame 层优先 |
| 手机一直「旧版」 | index.html 无缓存控制头，浏览器启发式缓存 | 网关加 no-cache / assets immutable |
| 502 | frp 隧道瞬时断开（frpc 重连窗口） | 链路自愈；顶部连接状态指示可提前感知 |
| 消息顺序乱 | 历史回填与 mux 实时流到达竞争 | pushEvents 按 seq 全局排序合并 |
| 伪造 JWT 401 | VPS 网关密钥与本地不同（各自 .secret） | 用 systemd 环境变量 MOBILE_SIGNING_SECRET（强随机）伪造才能通 |
| 加载慢（12.7MB/6.3万事件） | history 全量含 99.6% 流式 chunk 增量 | 首屏 maxMessages 分页 + 前端过滤 |
| 改了服务器手机永远是旧版 | 旧 sw.js 响应带 immutable 缓存头，浏览器缓存后永不检查更新 | 网关 sw.js 改 no-cache；SW 注册 URL 带构建时间戳；controllerchange 自动刷新 |
| 新 SW 接管后主页仍旧版 | SW install 时 caches.addAll 把旧页面写进新缓存 | install 不再预缓存页面；/ 与 index.html 网络优先+离线兜底；activate 清旧缓存 |
| 访问 /x 手机提示下载 | 网关 SPA fallback 用不存在路径的扩展名 → content-type=octet-stream | fallback 时显式 ext='.html' |
| PowerShell 写文件中文变乱码 | Set-Content/Invoke-RestMethod 的编码问题（GBK↔UTF-8） | 写代码文件用 write 工具；调 API 传中文用 node 脚本 |
| 会话标题变 ???? | PowerShell Invoke-RestMethod 传中文 title 编码损坏 | 用 node 发 UTF-8 JSON |
| 反复新建空会话 | 空会话（blank=true）不在 session.list → 缓存校验失败每次新建 | 缓存 sessionId 直接复用不校验；标题查找跳过 blank |

## 后续方向

见 [ROADMAP.md](ROADMAP.md)：P2P 直连（Tailscale）、APK 打包、推送通知、PIN 二次确认等。
