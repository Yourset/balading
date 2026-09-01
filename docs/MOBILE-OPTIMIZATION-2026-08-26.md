# 移动端优化方案（2026-08-26）：底部 4 菜单 + 私人助手 + AI 绘画 + 自动更新

> 本次重构 dsh-mobile 的功能结构与更新机制，方案、改动清单与验证结果全记录。
> 配套踩坑见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)；架构全貌见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 一、背景与目标

维护者反馈：移动端底部东西太多，只要三样——私人助手（长期记忆 + 存服务器 + 预留语音）、笔记、AI 绘画，加上会话共 4 个菜单。

现状：底部 5 菜单（对话/任务/工作区/AI笔记/我的）；前端源码在 `web/src`，部署到 VPS `/opt/dsh-mobile/web/dist`，由网关(8788) 反代，经 frp 隧道连主电脑 DSH(3080)。

## 二、最终方案

### 1. 底部菜单 5 → 4

`web/src/App.jsx`：

| 菜单 | 路由 | 说明 |
|---|---|---|
| 💬 会话 | `#/` | 原有会话列表 |
| 🤖 私人助手 | `#/assistant` | 新页（固定会话 + 记忆） |
| 📓 笔记 | `#/notes` | 原有 AI 笔记（改名词条） |
| 🎨 AI绘画 | `#/paint` | 新页（固定会话 + 快捷提示词） |

- 任务、工作区、我的入口移除（API 仍在，仅菜单消失）。
- 解绑设备入口（原「我的」页）移到私人助手页顶栏 🔓 图标。

### 2. 私人助手（长期记忆 + 存服务器）

- 新页 `web/src/pages/AssistantPage.jsx`：固定一个会话（`agentPreset: mobile`，cwd=`<本地工作区路径>`），复用 `ChatPage` 全部聊天能力。
- 会话解析策略（`resolveSession`）：
  1. `localStorage` 缓存 sessionId → **直接复用**（不校验列表，空会话可能不在 list 里但 id 始终有效）；
  2. 按标题查找（`projections.values.title === '私人助手'`，**跳过 blank 空会话**）；
  3. 都没有 → `session.create` 新建并 `session.rename` 设标题。
- 长期记忆闭环：
  - 会话内 AI（mobile 预设）把重要事实写入 `%USERPROFILE%\.dsh\mobile\memory.md`；
  - `tools/note-sync.mjs` 扩展：额外 watch memory.md → scp 到 VPS `/opt/ai-notes/memory.md`（自动同步，随登录自启 dsh-note-sync.vbs）；
  - 换设备/换手机：新设备首次进入自动按标题找到原会话 → 记忆和聊天记录都在。

### 3. AI 绘画

- 新页 `web/src/pages/PaintPage.jsx`：固定「AI绘画」会话（mobile 预设），欢迎卡 + 4 个快捷提示词 chips（点击直接 `session.prompt` 发送）。
- 出图链路：手机描述 → 主电脑 DSH（codex_imagegen）生成 → 图片经本机 8791 发图服务 + frp 隧道 → VPS → 手机显示（见下）。

### 4. 图片显示链路（手机可看 AI 图）

主电脑 DSH 的 chat-image-send 技能生成 `http://127.0.0.1:8791/<file>` 链接，手机访问不了回环地址。三层改造：

1. **frp 隧道**：`tools/frp/frpc.toml` 新增 `dsh-img` 代理：本机 8791 → VPS 8792。
2. **网关代理**：`server/index.mjs` 新增 `/img/*` 路由 → 反代 `127.0.0.1:8792`。
3. **前端重写**：`web/src/md.jsx` 的 `escUrl` 把 `http://127.0.0.1:8791/` 图片链接重写为同源 `/img/`。

### 5. 自动更新机制（重点）

背景：旧 sw.js 曾带 `immutable` 缓存头，浏览器缓存后永不检查更新，导致手机永远旧版、只能手动清缓存。本次根治：

1. **网关缓存策略**（`server/index.mjs` staticServe）：`sw.js` 与 `index.html` 一律 `no-cache`；仅 `/assets/*` 与带 hash 的静态资源 immutable。
2. **SW 注册带构建时间戳**（`web/vite.config.js` define `__BUILD_TS__` + `web/src/main.jsx`）：`register('/sw.js?v=<构建时间戳>')` —— 每次发版 URL 变化，绕过浏览器对旧 sw.js 的永久缓存，强制拉取最新 SW。
3. **SW 接管自动刷新**（`main.jsx`）：监听 `controllerchange`，新 SW 激活后自动 `location.reload()`（5s 防抖防刷新循环）。
4. **SW v12 策略重写**（`web/public/sw.js`）：
   - `install` **不再预缓存页面**（避免把旧页面写进新缓存导致更新失效）；
   - `/` 与 `/index.html`：**网络优先 + 离线缓存兜底**（保证每次打开都是服务器最新版）；
   - `/assets/*`：cache-first（hash 文件名 immutable）；
   - 附件 / API：保持原策略；
   - `activate` 清理所有旧版本缓存。
5. **SPA fallback 类型修复**（`server/index.mjs`）：深层路径回退 index.html 时 `content-type` 必须为 `text/html`（曾因 ext 取不到而返回 `application/octet-stream`，手机提示下载）。

### 6. 升级入口（存量设备一次性操作）

已缓存旧 SW 的存量手机，用任意不存在的路径打开一次即强制走网络拿新版：

```
https://m.example.com/x   （x 可换成任意字母）
```

旧 SW 对非缓存路径是网络优先 → 拿到新版 index.html → 新版注册新 SW（带时间戳）→ 接管并清旧缓存 → 此后主页 `/` 也是新版，永久自动更新。

### 7. 图片压缩 + md5 内容寻址（2026-08-26 追加）

解决 VPS 中转带宽慢：**主电脑图片服务端即时压缩**，手机/桌面拿到的都是压缩版，前端零改动。

- 改动：`SpaceServiceArea/tools/dsh-plugins/chat-image-server/lib/index.js`（ssa-chat-image-server 插件，随 DSH 常驻 8791）。
- 压缩：png/jpg/jpeg/webp 请求时 sharp 转 WebP（宽 ≤1280、质量 80、effort 4），压缩后更大则回退原图；gif/svg 直通。
- md5 内容寻址：压缩产物存 `<共享目录>/.cache/<内容md5>.webp`，同内容不同文件名共享一份；响应带 `ETag=md5`，`If-None-Match` 命中返回 304。
- 效果实测：1MB 截图 → 20~55KB WebP，省 96~98%；VPS 带宽压力降一个数量级。
- 依赖：sharp 装在 `~/.dsh/profiles/web`（`npm install sharp --save --legacy-peer-deps`）。
- **坑**：DSH/cordis 把插件 bundle 进主进程后，普通 `require('sharp')` 解析不到 profiles/web 依赖 → 必须按绝对路径加载（`~/.dsh/profiles/web/node_modules/sharp`）；改插件后需重启 DSH web 生效（看门狗自动拉起，会话持久化不丢）。

## 三、改动文件清单

**前端** `web/src/`：
- `App.jsx`（菜单 4 项 + 路由 + 顶栏解绑入口）
- `pages/AssistantPage.jsx`（新增：私人助手）
- `pages/PaintPage.jsx`（新增：AI绘画）
- `pages/ChatPage.jsx`（`onHasMessages` 回调；流式 live 残留清理：assistant/message 与 turn/end 到达时过滤 live 项）
- `pages/NotesPage.jsx`（列表过滤 `memory.md`）
- `md.jsx`（图片 URL 重写 127.0.0.1:8791 → /img/）
- `main.jsx`（SW 注册带时间戳 + controllerchange 自动刷新）
- `styles.css`（欢迎卡、快捷提示词 chips）
- `public/sw.js`（v12 策略重写）

**工程**：
- `vite.config.js`（define `__BUILD_TS__`）
- `server/index.mjs`（/img/ 代理、sw.js no-cache、SPA fallback 类型修复）
- `tools/note-sync.mjs`（memory.md 同步 VPS）
- `tools/frp/frpc.toml`（8792 图片隧道）
- `capacitor.config.json`（预配置 server.url 远程壳模式，备用）

**VPS**：`/opt/dsh-mobile/web/dist`（v12 构建）、`/opt/dsh-mobile/server/index.mjs`（网关）、systemd 重启、frp 8792 端口。

## 四、验证结果（均已实测通过）

| 项 | 结果 |
|---|---|
| 底部 4 菜单 | ✅ 手机实测 |
| 私人助手欢迎卡 / 会话复用 | ✅ 新设备自动找到原会话、历史回显 |
| 记忆写入 + 同步 VPS | ✅ memory.md 自动同步 /opt/ai-notes |
| 换设备找回记忆 | ✅ 全新设备进入即见历史对话 |
| AI 绘画出图 | ✅ 柴犬头像生成成功 |
| 图片手机显示 | ✅ 经 /img/ 链路正常渲染 |
| 流式重复显示修复 | ✅ 历史与实时流均无重复 |
| 存量设备升级入口 | ✅ 手机 Via 访问 /x 后主页变新版 |

## 五、待办 / 后续

- 语音输入：架构已预留（会话层），后续接语音模型。
- 测试产生的空会话（无删除 API）留在主电脑 DSH，不影响使用，后续可人工清理。
- Capacitor 远程壳 APK：config 已改好（server.url + allowNavigation），需要时按 [P2-BUILD.md](../P2-BUILD.md) 打包，一次重装后永久热更新。