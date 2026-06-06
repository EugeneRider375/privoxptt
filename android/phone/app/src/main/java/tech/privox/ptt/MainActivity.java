package tech.privox.ptt;

import android.Manifest;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int MIN_WEBVIEW_MAJOR_VERSION = 100;
    private static final int RECORD_AUDIO_REQUEST_CODE = 100;
    private static volatile boolean appInForeground = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        registerPlugin(PrivoxPushPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        enableFullscreenMode();
        requestMicrophonePermission();
        requestNotificationPermission();
        requestFullScreenCallPermission();
        requestBatteryOptimizationExemption();
        warnIfWebViewIsOutdated();
        startPrivoxService();
    }

    public static boolean isAppInForeground() {
        return appInForeground;
    }

    @Override
    public void onStart() {
        super.onStart();
        appInForeground = true;
        PrivoxIncomingCallRinger.stop();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(2001);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableFullscreenMode();
        }
    }

    private void enableFullscreenMode() {
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {}
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        ActivityCompat.requestPermissions(this, new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 101);
    }

    private void requestFullScreenCallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.canUseFullScreenIntent()) return;
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {}
    }

    private void requestMicrophonePermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            return;
        }

        ActivityCompat.requestPermissions(
            this,
            new String[] { Manifest.permission.RECORD_AUDIO },
            RECORD_AUDIO_REQUEST_CODE
        );
    }

    private void warnIfWebViewIsOutdated() {
        PackageInfo webViewPackage = WebViewCompat.getCurrentWebViewPackage(this);
        if (webViewPackage == null || getMajorVersion(webViewPackage.versionName) >= MIN_WEBVIEW_MAJOR_VERSION) {
            return;
        }

        new AlertDialog.Builder(this)
            .setTitle("Update Android WebView")
            .setMessage(
                "PRIVOX PTT needs a newer Android System WebView for stable PTT audio.\n\n" +
                "Installed WebView: " + webViewPackage.versionName + "\n\n" +
                "Please update Android System WebView in Google Play, then restart PRIVOX PTT."
            )
            .setPositiveButton("Update", (dialog, which) -> openPlayStore("com.google.android.webview"))
            .setNegativeButton("Continue", null)
            .show();
    }

    private int getMajorVersion(String versionName) {
        if (versionName == null || versionName.isEmpty()) {
            return 0;
        }
        try {
            return Integer.parseInt(versionName.split("\\.")[0]);
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private void openPlayStore(String packageName) {
        Uri marketUri = Uri.parse("market://details?id=" + packageName);
        Intent marketIntent = new Intent(Intent.ACTION_VIEW, marketUri);
        try {
            startActivity(marketIntent);
        } catch (ActivityNotFoundException ex) {
            Uri webUri = Uri.parse("https://play.google.com/store/apps/details?id=" + packageName);
            startActivity(new Intent(Intent.ACTION_VIEW, webUri));
        }
    }

    // Capacitor calls webView.onPause() which suspends JS execution including Socket.IO
    // heartbeat — server then disconnects the client. We immediately re-resume the WebView
    // so JS keeps running while the foreground service holds CPU and WiFi awake.
    @Override
    public void onPause() {
        super.onPause();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().onResume();
            getBridge().getWebView().resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        appInForeground = false;
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().onResume();
            getBridge().getWebView().resumeTimers();
        }
    }

    private void startPrivoxService() {
        Intent serviceIntent = new Intent(this, PrivoxForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }
}
