# Android 语音输入：权限、触摸与发布排障

本文记录巴拉丁 Android APK（Capacitor 6 WebView）接入网页流式录音时的长期可复用经验。

## 结论先行

Android 系统设置显示“麦克风已允许”，不等于 WebView 的 `navigator.mediaDevices.getUserMedia()` 一定可用。

语音输入需要同时打通三层：

1. **APK Manifest 声明**：`RECORD_AUDIO` 与 `MODIFY_AUDIO_SETTINGS`。
2. **Android 运行时授权**：用户允许危险权限 `RECORD_AUDIO`。
3. **WebView 媒体授权**：Capacitor 的 `BridgeWebChromeClient.onPermissionRequest` 收到 `AUDIO_CAPTURE` 后放行网页请求。

Capacitor 6 的默认实现会为 `AUDIO_CAPTURE` 同时检查：

- `android.permission.RECORD_AUDIO`
- `android.permission.MODIFY_AUDIO_SETTINGS`

如果 Manifest 只声明了 `RECORD_AUDIO`，系统权限页仍会显示麦克风“已允许”，但 WebView 的整组媒体请求会失败，前端常表现为“按住后闪一下”并提示没有麦克风权限。

## 正确的 Manifest

`android/app/src/main/AndroidManifest.xml` 至少应包含：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

其中：

- `RECORD_AUDIO` 是危险权限，需要运行时申请。
- `MODIFY_AUDIO_SETTINGS` 是普通权限，不会单独弹系统授权框，但必须写入 Manifest。

## 覆盖安装的权限规则

覆盖安装通常会保留原应用数据和权限状态：

- 已允许的权限通常继续允许。
- 已拒绝的权限通常继续拒绝。
- 用户多次拒绝或选择“不再询问”后，系统可能不再弹授权框。
- 新版本新增危险权限时，仍需应用主动申请；新增普通权限只需 Manifest 声明。

因此应用设置页应同时提供：

- 当前权限状态查询；
- “重新申请全部权限”；
- “打开系统权限设置”；
- 从系统设置返回后自动刷新状态。

当前动态权限包括麦克风和通知。选图使用 Android 系统选择器，不需要申请传统的整盘存储权限。

## “按住闪烁”要先区分权限还是触摸

不要看到录音控件闪烁就直接判断为触摸区域 Bug。录音开始流程通常会先把 UI 切到连接态，然后调用 `getUserMedia()`：

1. 手指按下，录音状态变为 `connecting`；
2. `getUserMedia()` 被拒绝；
3. 状态立即变为 `error`；
4. 录音态 UI 消失，看起来像触摸按钮闪烁。

判断方法：

- 同时出现“请允许使用麦克风”时，优先检查权限链。
- 系统权限页显示已允许但仍失败时，检查 APK 是否声明 `MODIFY_AUDIO_SETTINGS`。
- 权限链全部确认后仍提前结束，再排查 `touchcancel` / `pointercancel`。

## Android 长按手势建议

Android WebView 可能产生合成的 `pointercancel`。稳定方案是：

- 触屏设备单独处理 `touchstart`、`touchmove`、`touchend`、`touchcancel`；
- 鼠标/触控笔才走 Pointer Events；
- 用独立手势 ID 防止 Touch 与 Pointer 合成事件重复启动录音；
- 用独立 `holding` 状态保持长按界面，不让录音连接状态决定按钮是否存在；
- 只有松手时仍位于取消区才取消录音；
- `touch-action: none`，避免滚动手势抢占长按。

注意：触摸修复不能代替权限修复，两者应分别验证。

## APK 验证顺序

### 1. 构建前端并同步 Android

```powershell
npm.cmd run build
npx.cmd cap sync android
```

### 2. 检查最终 APK，而不是只看源文件

最终包至少要确认：

- 包名正确；
- `versionCode` 高于已安装版本；
- 签名证书与正式版本一致；
- `RECORD_AUDIO` 存在；
- `MODIFY_AUDIO_SETTINGS` 存在。

只检查源 Manifest 不够，因为最终合并后的 Android Manifest 才是安装包真值。

### 3. 检查公网产物

正式发布后比较：

- 云构建 APK 的 SHA256；
- 公网下载 APK 的 SHA256；
- 公网 APK 的版本号与签名。

避免服务器仍提供旧包、缓存包或调试签名包。

## 版本号建议

同一小时可能连续构建多次，`yyyyMMddHH` 不能保证每次递增。可使用：

```text
versionCode = 2_000_000_000 + floor(epochSeconds / 60)
```

它按分钟递增，且在较长时间内仍低于 Android 32 位有符号整数上限。

## 真机验收清单

1. 覆盖安装成功，版本号高于上一版。
2. 设置 → 权限管理显示麦克风“已允许”。
3. 长按“按住说话”，控件持续保持录音状态。
4. 松手后进入识别，不再提示无权限。
5. 上滑进入取消区会变为取消态；移出后解除取消态。
6. 在取消区松手不会发送。
7. 普通区域松手能识别，并按“识别后编辑/自动发送”设置处理结果。
8. 失败、空文本和主动取消不会自动发送。

## 排障原则

- 系统权限页只是证据之一，不是 WebView 可录音的最终证明。
- 构建成功不是功能验收；必须保留真机长按与识别验收。
- 先读框架真实源码，再判断缺哪个权限，避免只根据错误文案反复修改触摸逻辑。
- 每次发布都验证最终 APK 权限、版本、签名和公网哈希。
