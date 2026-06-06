package tech.privox.ptt;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int MIN_WEBVIEW_MAJOR_VERSION = 100;
    private static final int RECORD_AUDIO_REQUEST_CODE = 100;

    // Inrico T320 side PTT button reports KEYCODE_TV_DATA_SERVICE (230) to the app.
    // Confirmed from the wrapper's own dispatchKeyEvent log on-device.
    // (The center D-pad button is KEYCODE_DPAD_CENTER (23) and is left for navigation.)
    private static final int KEYCODE_PTT = KeyEvent.KEYCODE_TV_DATA_SERVICE;
    // Black button (231, VOICE_ASSIST) is the only side button that wakes the screen from off.
    // We treat it as a secondary PTT so pressing it while screen-off wakes + transmits.
    private static final int KEYCODE_PTT_WAKE = KeyEvent.KEYCODE_VOICE_ASSIST;

    // WebRTC (Chrome WebView) puts the device into MODE_IN_COMMUNICATION while
    // talking/listening, which routes audio to the quiet earpiece. For a walkie-
    // talkie we always want the loud speaker, so we keep speakerphone forced on
    // while the app is in the foreground (re-asserted because Chrome toggles the
    // audio mode on every PTT).
    private AudioManager audioManager;
    private final Handler audioHandler = new Handler(Looper.getMainLooper());
    private static final long SPEAKER_REASSERT_MS = 1500;
    private final Runnable keepSpeakerOn = new Runnable() {
        @Override
        public void run() {
            forceSpeakerphone();
            audioHandler.postDelayed(this, SPEAKER_REASSERT_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Wake screen and show app over lock screen when PTT is pressed with screen off.
        // FLAG_DISMISS_KEYGUARD removes non-secure lock screen so PTT goes straight to transmit.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        enableFullscreenMode();
        requestMicrophonePermission();
        warnIfWebViewIsOutdated();
        startPrivoxService();
    }

    @Override
    public void onResume() {
        super.onResume();
        audioHandler.removeCallbacks(keepSpeakerOn);
        audioHandler.post(keepSpeakerOn);
    }

    @Override
    public void onPause() {
        audioHandler.removeCallbacks(keepSpeakerOn);
        super.onPause();
    }

    private void forceSpeakerphone() {
        if (audioManager == null) {
            return;
        }
        if (!audioManager.isSpeakerphoneOn()) {
            audioManager.setSpeakerphoneOn(true);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableFullscreenMode();
        }
    }

    // Hardware Back (curved arrow): ask the radio screen to step back one level
    // (group -> groups list). If the web handled it, do nothing; otherwise (at
    // the top level) just background the app — keeps it warm and signed in,
    // instead of going to a cold start.
    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(
                "(function(){try{return (window.__privoxRadioBack && window.__privoxRadioBack()) ? '1' : '0';}catch(e){return '0';}})()",
                value -> {
                    if (value == null || !value.contains("1")) {
                        moveTaskToBack(true);
                    }
                }
            );
        } else {
            moveTaskToBack(true);
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

    // --- Hardware PTT -> web app -------------------------------------------------
    // The web app starts/stops transmitting on Space (its on-screen hint is
    // "HOLD TO TALK or [SPACE]"). We translate the hardware PTT button into a
    // synthetic Space keydown/keyup dispatched into the WebView, so no changes to
    // the web app are needed.

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        final int keyCode = event.getKeyCode();
        final int action = event.getAction();
        // Diagnostic: log every key the activity sees so we can confirm the PTT code.
        android.util.Log.d("PrivoxPTT", "dispatchKeyEvent code=" + keyCode
            + " action=" + action + " repeat=" + event.getRepeatCount());

        if (keyCode == KEYCODE_PTT || keyCode == KEYCODE_PTT_WAKE) {
            if (action == KeyEvent.ACTION_DOWN) {
                if (event.getRepeatCount() == 0) {
                    dispatchSpaceToWebView("keydown");
                }
            } else if (action == KeyEvent.ACTION_UP) {
                dispatchSpaceToWebView("keyup");
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void dispatchSpaceToWebView(String type) {
        if (getBridge() == null) {
            return;
        }
        final WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }
        final String js =
            "(function(){var e=new KeyboardEvent('" + type + "'," +
            "{key:' ',code:'Space',keyCode:32,which:32,bubbles:true,cancelable:true});" +
            "document.dispatchEvent(e);window.dispatchEvent(e);})()";
        webView.post(() -> webView.evaluateJavascript(js, null));
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
