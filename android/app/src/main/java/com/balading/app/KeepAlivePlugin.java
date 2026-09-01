package com.balading.app;

import android.webkit.CookieManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** WebView 与 Android 原生后台通知服务之间的最小桥接。 */
@CapacitorPlugin(name = "KeepAlive")
public class KeepAlivePlugin extends Plugin {

    @PluginMethod
    public void configure(PluginCall call) {
        String serverUrl = call.getString("serverUrl", "");
        if (serverUrl.isEmpty()) {
            call.reject("缺少 serverUrl");
            return;
        }
        String deviceId = call.getString("deviceId", "");
        KeepAliveService.configure(getContext(), serverUrl, deviceId);
        String cookie = CookieManager.getInstance().getCookie(serverUrl);
        boolean authenticated = cookie != null && cookie.contains("dsh_device=");
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("authenticated", authenticated);
        call.resolve(result);
    }

    @PluginMethod
    public void updateStatus(PluginCall call) {
        KeepAliveService.updateContent(getContext(), call.getString("text", "运行中，随时待命"));
        call.resolve();
    }

    @PluginMethod
    public void setVisibility(PluginCall call) {
        KeepAliveService.setAppActive(getContext(), Boolean.TRUE.equals(call.getBoolean("active", false)));
        call.resolve();
    }

    @PluginMethod
    public void dismissSession(PluginCall call) {
        KeepAliveService.dismissSession(getContext(), call.getString("sessionId", ""));
        call.resolve();
    }

    @PluginMethod
    public void consumeOpen(PluginCall call) {
        JSObject result = new JSObject();
        result.put("sessionId", KeepAliveService.consumePendingOpen(getContext()));
        call.resolve(result);
    }
}
