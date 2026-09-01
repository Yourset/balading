# dsh-mobile Android App 打包指南（Capacitor）

## 架构说明

- APK 是「壳」：本地打包前端资源（不依赖固定服务器），**首次启动输入你自己的网关地址**（域名或 VPS IP:端口，存 localStorage）。
- **热更新**：界面更新 = 部署你的服务器，重新打开 APK 即拉到最新前端（SW 自动更新）。
- **缓存**：Service Worker 已内置（`sw.js` v14）——页面入口 stale-while-revalidate（秒开 + 后台静默更新）、静态资源 cache-first、附件 sha256 缓存、API SWR。
- **本地通知**：`@capacitor/local-notifications`（6.1.3）——AI 回复完成且页面在后台时弹系统通知。
- **后台驻留**：`KeepAliveService` 前台保活服务（通知栏常驻「私人助手运行中」），specialUse FGS + START_STICKY。
- **专属品牌**：AI 机器人图标（`android/icon-master.png` 生成各尺寸）、启动页、应用名「私人助手」。

## 云端构建（已启用，推荐）

GitHub Actions 工作流 `.github/workflows/build-apk.yml`（repo：`<your-github>/balading`）：

- 触发：`git push origin master`（改动 web/android/capacitor 配置时自动构建）；也可 GitHub Actions 页手动 `workflow_dispatch`。
- 产物：Actions 运行页 → 底部 Artifacts → `balading-apk`（未配签名 secrets 时产物为未签名 APK）。
- 本地取回：`gh run download <run-id> -R <your-github>/balading -D dist-apk`。
- 发布：APK 传 VPS `/opt/dsh-mobile/web/dist/` → 手机下载 `https://m.yourdomain.com/app-release.apk`。

## 安装到手机

- 手机浏览器打开 `https://m.yourdomain.com/app-release.apk` → 下载 → 允许「安装未知来源应用」→ 安装。
- 首次打开先输入服务器地址（`m.yourdomain.com` 或 `YOUR_VPS_IP:8788`），再进设备绑定页；VPS 生成一次性令牌（用后即焚）：
  `ssh ubuntu@YOUR_VPS_IP "cd /opt/dsh-mobile/server && sudo node index.mjs --gen-token"`
- 绑定后长期可用；卸载重装需重新绑定（WebView 数据独立于浏览器）。

## 通知权限说明

- Android 13+：首次使用会请求通知权限（`POST_NOTIFICATIONS`）。
- 后台通知触发条件：APP 在后台且进程存活（前台保活服务显著提升存活率）。
- 被系统彻底杀死后收不到（需 FCM 云推送，国内无 GMS 受限，暂缓）。

## 正式版签名（可选，后续）

- 生成 keystore：`keytool -genkey -v -keystore dsh-release.keystore -alias dsh -keyalg RSA -keysize 2048 -validity 10000`
- workflow 增加 `assembleRelease` + signing 配置（secrets 存 keystore）。

## 本地打包环境（备用）

1. JDK 17：`winget install Microsoft.OpenJDK.17`（或 Android Studio 自带）。
2. Android SDK：装 Android Studio（或仅 Command Line Tools），设 `ANDROID_HOME`；需要 platform-tools、platforms;android-34、build-tools;34.0.0。
3. `npm run build`（web）→ `npx cap sync android` → `cd android && gradlew assembleDebug`。