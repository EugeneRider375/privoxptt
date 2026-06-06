package tech.privox.ptt;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

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
            .putLong(PrivoxPushPlugin.KEY_CREATED_AT, System.currentTimeMillis())
            .apply();
    }

    private void showIncomingCall(Map<String, String> data) {
        createCallChannel();

        Intent answer = new Intent(this, MainActivity.class)
            .putExtra("privox_call_id", value(data, "callId"))
            .putExtra("privox_group_id", value(data, "groupId"))
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent answerIntent = PendingIntent.getActivity(
            this, 201, answer, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );

        Intent incomingScreen = new Intent(this, IncomingCallActivity.class)
            .putExtra("from_callsign", value(data, "fromCallsign"))
            .putExtra("from_display_name", value(data, "fromDisplayName"))
            .putExtra("group_name", value(data, "groupName"))
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent incomingScreenIntent = PendingIntent.getActivity(
            this, 203, incomingScreen, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );

        Intent decline = new Intent(this, PrivoxCallActionReceiver.class)
            .setAction(PrivoxCallActionReceiver.ACTION_DECLINE)
            .putExtra("notification_id", NOTIFICATION_ID);
        PendingIntent declineIntent = PendingIntent.getBroadcast(
            this, 202, decline, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );

        String callsign = value(data, "fromCallsign");
        String groupName = value(data, "groupName");
        Person caller = new Person.Builder()
            .setName(callsign.isEmpty() ? "PRIVOX PTT" : callsign)
            .setImportant(true)
            .build();

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
            .setTimeoutAfter(45_000)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declineIntent, answerIntent));

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
