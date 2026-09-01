package com.balading.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 向设置页提供当前巴拉丁 APK、设备和网络诊断信息，不读取其他应用或个人文件。 */
@CapacitorPlugin(name = "AppDiagnostics")
public class AppDiagnosticsPlugin extends Plugin {

    /** 返回排查安装版本、热更新来源和设备兼容性所需的最小信息集合。 */
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject result = new JSObject();
        try {
            PackageInfo packageInfo = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? packageInfo.getLongVersionCode() : packageInfo.versionCode;
            result.put("packageName", getContext().getPackageName());
            result.put("versionName", packageInfo.versionName == null ? "" : packageInfo.versionName);
            result.put("versionCode", versionCode);
            result.put("firstInstallTime", packageInfo.firstInstallTime);
            result.put("lastUpdateTime", packageInfo.lastUpdateTime);
        } catch (Exception error) {
            result.put("packageError", error.getMessage());
        }

        result.put("manufacturer", Build.MANUFACTURER);
        result.put("model", Build.MODEL);
        result.put("androidVersion", Build.VERSION.RELEASE);
        result.put("androidSdk", Build.VERSION.SDK_INT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PackageInfo webView = WebView.getCurrentWebViewPackage();
            result.put("webViewVersion", webView == null ? "" : webView.versionName);
        }
        result.put("networkType", readNetworkType());
        call.resolve(result);
    }

    /** 只返回当前连接类型，不读取 Wi-Fi 名称、基站、IP 或定位信息。 */
    private String readNetworkType() {
        try {
            ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network network = manager == null ? null : manager.getActiveNetwork();
            NetworkCapabilities capabilities = network == null || manager == null ? null : manager.getNetworkCapabilities(network);
            if (capabilities == null) return "offline";
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "vpn";
            return "other";
        } catch (Exception error) {
            return "unknown";
        }
    }
}
