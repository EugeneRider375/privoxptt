package tech.privox.ptt;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class PrivoxFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "privox_incoming_calls_v2";
    private static final int NOTIFICATION_ID = 2001;

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (!"incoming_user_call".equals(data.get("type"))) return;
        if (MainActivity.isAppInForeground()) return;

        savePendingCall(data);
        showIncomingCall(data);
        PrivoxIncomingCallRinger.start(this);
    }

    private void savePendingCall(Map<String, String> data) {
        SharedPreferences prefs = getSharedPreferences(PrivoxPushPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(PrivoxPushPlugin.KEY_CALL_ID, value(data, "callId"))
            .putString(PrivoxPushPlugin.KEY_FROM_CALLSIGN, value(data, "fromCallsign"))
            .putString(PrivoxPushPlugin.KEY_FROM_DISPLAY_NAME, value(data, "fromDisplayName"))
            .putString(PrivoxPushPlugin.KEY_GROUP_ID, value(data, "groupId"))
            .putString(PrivoxPushPlugin.KEY_GROUP_NAME, value(data, "groupName"))
            .putString(PrivoxPushPlugin.KEY_RESPONSE_URL, value(data, "responseUrl"))
            .putString(PrivoxPushPlugin.KEY_RESPONSE_TOKEN, value(data, "responseToken"))
            .putString(PrivoxPushPlugin.KEY_CALL_KIND, value(data, "kind"))
            .remove(PrivoxPushPlugin.KEY_RESPONSE_STATUS)
            .putLong(PrivoxPushPlugin.KEY_CREATED_AT, System.currentTimeMillis())
            .apply();
    }

    private void showIncomingCall(Map<String, String> data) {
        createCallChannel();

        Intent incomingScreen = new Intent(this, IncomingCallActivity.class)
            .putExtra("from_callsign", value(data, "fromCallsign"))
            .putExtra("from_display_name", value(data, "fromDisplayName"))
            .putExtra("group_name", value(data, "groupName"))
            .putExtra("call_id", value(data, "callId"))
            .putExtra("response_url", value(data, "responseUrl"))
            .putExtra("response_token", value(data, "responseToken"))
            .putExtra("call_kind", value(data, "kind"))
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent incomingScreenIntent = PendingIntent.getActivity(
            this, 203, incomingScreen, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );

        String callsign = value(data, "fromCallsign");
        String groupName = value(data, "groupName");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(callsign.isEmpty() ? "PRIVOX PTT call" : callsign)
            .setContentText(groupName.isEmpty() ? "Incoming call" : "Calls you in " + groupName)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(incomingScreenIntent, true)
            .setContentIntent(incomingScreenIntent)
            .setTimeoutAfter(45_000);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, builder.build());
    }

    private void createCallChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "PRIVOX incoming calls", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Incoming PRIVOX PTT user and group calls");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 300, 500});
        channel.setSound(null, null);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private static int immutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private static String value(Map<String, String> data, String key) {
        String value = data.get(key);
        return value == null ? "" : value;
    }
}
