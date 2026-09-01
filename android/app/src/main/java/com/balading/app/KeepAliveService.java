package com.balading.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Android 原生后台同步服务。
 *
 * <p>服务使用前台通知提升存活率，并直接长轮询 VPS 通知账本。它不依赖 WebView、
 * JavaScript 定时器或页面是否可见，因此切后台和锁屏后仍能接收 DSH 回合终态。</p>
 */
public class KeepAliveService extends Service {
    private static final String KEEPALIVE_CHANNEL_ID = "dsh-keepalive";
    private static final String RESULT_CHANNEL_ID = "dsh-task-result-native";
    private static final String RESULT_GROUP = "dsh-task-results";
    private static final int KEEPALIVE_NOTIFICATION_ID = 1001;
    private static final String PREFS = "dsh-native-notifications";
    private static final String KEY_SERVER_URL = "serverUrl";
    private static final String KEY_DEVICE_ID = "deviceId";
    private static final String KEY_LAST_SEQ = "lastSequence";
    private static final String KEY_DELIVERED_PREFIX = "delivered:";
    private static final String KEY_APP_ACTIVE = "appActive";
    private static final String KEY_PENDING_OPEN = "pendingOpenSessionId";
    public static final String EXTRA_SESSION_ID = "notification_session_id";

    private volatile boolean stopped;
    private volatile HttpURLConnection activeConnection;
    private Thread syncThread;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        // 服务被系统单独重建时默认视为后台，避免沿用进程被杀前残留的“前台可见”标记。
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_APP_ACTIVE, false).apply();
        startForeground(KEEPALIVE_NOTIFICATION_ID, buildKeepAliveNotification("运行中，随时待命"));
        startSyncLoop();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startSyncLoop();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        HttpURLConnection connection = activeConnection;
        if (connection != null) connection.disconnect();
        if (syncThread != null) syncThread.interrupt();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    /** 保存服务地址和设备命名空间，并确保原生同步循环正在运行。 */
    public static void configure(Context context, String serverUrl, String deviceId) {
        if (context == null || serverUrl == null || serverUrl.trim().isEmpty()) return;
        String normalized = serverUrl.trim().replaceAll("/+$", "");
        String normalizedDeviceId = deviceId == null ? "" : deviceId.trim();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean namespaceChanged = !normalized.equals(prefs.getString(KEY_SERVER_URL, ""))
            || !normalizedDeviceId.equals(prefs.getString(KEY_DEVICE_ID, ""));
        SharedPreferences.Editor editor = namespaceChanged ? prefs.edit().clear() : prefs.edit();
        editor.putString(KEY_SERVER_URL, normalized).putString(KEY_DEVICE_ID, normalizedDeviceId).apply();
        Intent intent = new Intent(context, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    /** 页面可见时不弹系统结果通知，避免和前台音效重复。 */
    public static void setAppActive(Context context, boolean active) {
        if (context == null) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_APP_ACTIVE, active).apply();
    }

    /** 打开会话后移除该会话留下的系统通知。 */
    public static void dismissSession(Context context, String sessionId) {
        if (context == null || sessionId == null || sessionId.isEmpty()) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(notificationId(sessionId));
    }

    /** 通知点击入口在 Activity 生命周期中先持久化，WebView 就绪后再消费。 */
    public static void recordNotificationOpen(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String sessionId = intent.getStringExtra(EXTRA_SESSION_ID);
        if (sessionId == null || sessionId.isEmpty()) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_PENDING_OPEN, sessionId).apply();
    }

    /** 返回并清空等待打开的会话。 */
    public static String consumePendingOpen(Context context) {
        if (context == null) return "";
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String sessionId = prefs.getString(KEY_PENDING_OPEN, "");
        prefs.edit().remove(KEY_PENDING_OPEN).apply();
        return sessionId == null ? "" : sessionId;
    }

    /** 更新常驻通知的状态文字。 */
    public static void updateContent(Context context, String text) {
        if (context == null) return;
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;
            // 静态入口不能使用未 attach 的 Service 构造通知，因此直接复用 Context 构造。
            manager.notify(KEEPALIVE_NOTIFICATION_ID, buildKeepAliveNotification(context,
                text == null || text.isEmpty() ? "运行中，随时待命" : text));
        } catch (Exception ignored) {
            // 常驻文案更新失败不影响后台同步。
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel keepAlive = new NotificationChannel(
            KEEPALIVE_CHANNEL_ID, "私人助手运行中", NotificationManager.IMPORTANCE_LOW);
        keepAlive.setShowBadge(false);
        manager.createNotificationChannel(keepAlive);

        NotificationChannel results = new NotificationChannel(
            RESULT_CHANNEL_ID, "AI 任务结果", NotificationManager.IMPORTANCE_HIGH);
        results.setDescription("AI 回复完成或异常结束提醒");
        results.setShowBadge(true);
        results.enableVibration(true);
        manager.createNotificationChannel(results);
    }

    private Notification buildKeepAliveNotification(String text) {
        return buildKeepAliveNotification(this, text);
    }

    private static Notification buildKeepAliveNotification(Context context, String text) {
        Intent intent = new Intent(context, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, KEEPALIVE_CHANNEL_ID)
            : new Notification.Builder(context);
        return builder.setContentTitle("🤖 巴拉丁")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(Notification.PRIORITY_LOW)
            .build();
    }

    private synchronized void startSyncLoop() {
        if (syncThread != null && syncThread.isAlive()) return;
        stopped = false;
        syncThread = new Thread(this::runSyncLoop, "dsh-native-notification-sync");
        syncThread.setDaemon(true);
        syncThread.start();
    }

    private void runSyncLoop() {
        while (!stopped && !Thread.currentThread().isInterrupted()) {
            SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String serverUrl = prefs.getString(KEY_SERVER_URL, "");
            if (serverUrl == null || serverUrl.isEmpty()) {
                sleepQuietly(3000);
                continue;
            }
            long after = prefs.getLong(KEY_LAST_SEQ, 0L);
            HttpURLConnection connection = null;
            try {
                URL url = new URL(serverUrl + "/api/notification/events?after=" + after + "&wait=25000");
                connection = (HttpURLConnection) url.openConnection();
                activeConnection = connection;
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(12000);
                connection.setReadTimeout(35000);
                connection.setUseCaches(false);
                String cookie = CookieManager.getInstance().getCookie(serverUrl);
                if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
                int code = connection.getResponseCode();
                if (code == 401) {
                    updateContent(this, "等待 App 解锁或重新绑定");
                    sleepQuietly(30000);
                    continue;
                }
                if (code < 200 || code >= 300) throw new IllegalStateException("HTTP " + code);
                JSONObject root = new JSONObject(readText(connection.getInputStream()));
                JSONObject value = root.optJSONObject("value");
                if (!root.optBoolean("ok") || value == null) throw new IllegalStateException("通知响应异常");
                handleLedgerResponse(value, prefs, !prefs.contains(KEY_LAST_SEQ));
            } catch (Exception error) {
                updateContent(this, "后台同步重连中…");
                sleepQuietly(8000);
            } finally {
                if (connection != null) connection.disconnect();
                if (activeConnection == connection) activeConnection = null;
            }
        }
    }

    private void handleLedgerResponse(JSONObject value, SharedPreferences prefs, boolean bootstrap) {
        long sequence = value.optLong("sequence", prefs.getLong(KEY_LAST_SEQ, 0L));
        int unreadCount = value.optInt("unreadCount", 0);
        int runningCount = value.optInt("runningCount", 0);
        JSONArray events = value.optJSONArray("events");

        if (events != null) {
            for (int index = 0; index < events.length(); index++) {
                JSONObject event = events.optJSONObject(index);
                if (event != null && "read".equals(event.optString("kind"))) {
                    dismissSession(this, event.optString("sessionId", ""));
                }
            }
        }

        // 首次安装只建立游标；之后每次都用 snapshot 补偿，覆盖前台跳过、事件截断和断线恢复。
        if (!bootstrap && !prefs.getBoolean(KEY_APP_ACTIVE, false)) {
            JSONArray sessions = value.optJSONArray("sessions");
            if (sessions != null) {
                for (int index = 0; index < sessions.length(); index++) {
                    maybePostResultNotification(sessions.optJSONObject(index), unreadCount, prefs);
                }
            }
        }

        prefs.edit().putLong(KEY_LAST_SEQ, sequence).apply();
        updateContent(this, runningCount > 0 ? runningCount + " 个任务运行中" : "运行中，随时待命");
    }

    private void maybePostResultNotification(JSONObject session, int unreadCount, SharedPreferences prefs) {
        if (session == null || !session.optBoolean("unread") || !session.optBoolean("notifiable")) return;
        String status = session.optString("status", "");
        if (!"completed".equals(status) && !"error".equals(status)) return;
        String sessionId = session.optString("sessionId", "");
        String terminalKey = session.optString("terminalKey", "");
        if (sessionId.isEmpty() || terminalKey.isEmpty()) return;
        String deliveredKey = KEY_DELIVERED_PREFIX + sessionId;
        if (terminalKey.equals(prefs.getString(deliveredKey, ""))) return;
        postResultNotification(session, unreadCount);
        prefs.edit().putString(deliveredKey, terminalKey).apply();
    }

    private void postResultNotification(JSONObject session, int unreadCount) {
        String sessionId = session.optString("sessionId", "");
        if (sessionId.isEmpty()) return;
        String title = session.optString("title", "AI 会话");
        boolean completed = "completed".equals(session.optString("status"));
        String reason = session.optString("reasonKind", "");

        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra(EXTRA_SESSION_ID, sessionId);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, notificationId(sessionId), intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, RESULT_CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setContentTitle(completed ? "✅ AI 回复完成" : "❌ AI 异常结束")
            .setContentText(title)
            .setStyle(new Notification.BigTextStyle().bigText(completed ? title : title + "\n原因：" + reasonLabel(reason)))
            .setSmallIcon(completed ? android.R.drawable.stat_sys_download_done : android.R.drawable.stat_notify_error)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setGroup(RESULT_GROUP)
            .setNumber(Math.max(1, unreadCount))
            .setPriority(Notification.PRIORITY_HIGH);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) builder.setBadgeIconType(Notification.BADGE_ICON_SMALL);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(notificationId(sessionId), builder.build());
    }

    private static String reasonLabel(String reason) {
        if ("aborted".equals(reason)) return "已取消";
        if ("blocked".equals(reason)) return "任务阻塞";
        if ("max-tokens".equals(reason)) return "内容超限";
        if ("interrupted".equals(reason)) return "进程中断";
        return "执行错误";
    }

    private static int notificationId(String sessionId) {
        return 2000 + (sessionId.hashCode() & 0x3fffffff) % 1000000;
    }

    private static String readText(InputStream stream) throws Exception {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static void sleepQuietly(long millis) {
        try { Thread.sleep(millis); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
    }
}
