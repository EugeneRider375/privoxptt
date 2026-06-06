package tech.privox.ptt;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {
    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(buildContent());
        timeoutHandler.postDelayed(this::decline, 45_000);
    }

    private LinearLayout buildContent() {
        int padding = dp(14);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(padding, padding, padding, padding);
        root.setBackgroundColor(Color.rgb(10, 12, 10));

        TextView label = text("INCOMING CALL", 12, Color.rgb(61, 220, 132));
        TextView caller = text(getIntent().getStringExtra("from_callsign"), 23, Color.WHITE);
        TextView name = text(getIntent().getStringExtra("from_display_name"), 14, Color.LTGRAY);
        TextView group = text("GROUP: " + value(getIntent().getStringExtra("group_name")), 13, Color.rgb(74, 158, 255));

        root.addView(label);
        root.addView(caller);
        root.addView(name);
        root.addView(group);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        actions.setPadding(0, dp(12), 0, 0);

        Button decline = new Button(this);
        decline.setText("NO");
        decline.setOnClickListener(v -> decline());

        Button answer = new Button(this);
        answer.setText("ANSWER");
        answer.setOnClickListener(v -> answer());

        actions.addView(decline, new LinearLayout.LayoutParams(0, dp(48), 1));
        actions.addView(answer, new LinearLayout.LayoutParams(0, dp(48), 1));
        root.addView(actions);
        return root;
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value(value));
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        view.setPadding(0, dp(4), 0, dp(4));
        return view;
    }

    private void answer() {
        cancelNotification();
        Intent intent = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
        finish();
    }

    private void decline() {
        getSharedPreferences(PrivoxPushPlugin.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply();
        cancelNotification();
        finish();
    }

    private void cancelNotification() {
        PrivoxIncomingCallRinger.stop();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(2001);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String value(String value) {
        return value == null || value.isEmpty() ? "PRIVOX" : value;
    }
}
