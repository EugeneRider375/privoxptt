package tech.privox.ptt;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class PrivoxCallActionReceiver extends BroadcastReceiver {
    static final String ACTION_DECLINE = "tech.privox.ptt.DECLINE_CALL";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_DECLINE.equals(intent.getAction())) return;
        context.getSharedPreferences(PrivoxPushPlugin.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(intent.getIntExtra("notification_id", 2001));
    }
}
