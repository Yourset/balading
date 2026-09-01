package com.balading.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final int REQUEST_RECORD_AUDIO = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPermissionsPlugin.class);
        registerPlugin(AppDiagnosticsPlugin.class);
        registerPlugin(KeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
        KeepAliveService.recordNotificationOpen(this, getIntent());
        requestRecordAudioPermission();
        startKeepAlive();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        KeepAliveService.recordNotificationOpen(this, intent);
        String sessionId = intent == null ? "" : intent.getStringExtra(KeepAliveService.EXTRA_SESSION_ID);
        if (sessionId != null && !sessionId.isEmpty() && getBridge() != null && getBridge().getWebView() != null) {
            String script = "window.location.hash='#/chat/'+encodeURIComponent(" + JSONObject.quote(sessionId) + ");";
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
        }
    }

    /** 首次启动时申请录音权限，确保 WebView 的 getUserMedia 能拿到麦克风。 */
    private void requestRecordAudioPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
        }
    }

    /** 启动前台保活服务（通知栏常驻「私人助手运行中」）。 */
    private void startKeepAlive() {
        try {
            Intent it = new Intent(this, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(it);
            } else {
                startService(it);
            }
        } catch (Exception e) {
            // 前台服务启动失败不阻塞主流程
        }
    }
}
