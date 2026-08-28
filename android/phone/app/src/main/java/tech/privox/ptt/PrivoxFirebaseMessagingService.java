package tech.privox.ptt;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class PrivoxFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CALL_CHANNEL_ID = "privox_incoming_calls_v4";
    private static final String MESSAGE_CHANNEL_ID = "privox_messages_v1";
    private static final String MISSED_CALL_CHANNEL_ID = "privox_missed_calls_v1";
    private static final int CALL_NOTIFICATION_ID = 2001;
    static final int MESSAGE_NOTIFICATION_ID = 3001;
    private static final int MISSED_CALL_NOTIFICATION_ID = 2002;

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        if ("incoming_user_call".equals(type)) {
            if (MainActivity.isAppInForeground()) return;
            savePendingCall(data);
            showIncomingCall(data);
            PrivoxIncomingCallRinger.start(this);
            return;
        }

        if ("missed_call".equals(type)) {
            // Локальный таймер IncomingCallActivity уже сам гасит экран/звонок
            // за те же 45с — этот push просто закрывает то, что могло остаться
            // (гонка сеть/локальный таймер), и оставляет уведомление на экране.
            PrivoxIncomingCallRinger.stop();
            NotificationManager cancelManager = getSystemService(NotificationManager.class);
            if (cancelManager != null) cancelManager.cancel(CALL_NOTIFICATION_ID);
            showMissedCall(data);
            return;
        }

        if ("new_message".equals(type) && !MainActivity.isAppInForeground()) {
            showIncomingMessage(data);
        }
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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CALL_CHANNEL_ID)
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
        if (manager != null) manager.notify(CALL_NOTIFICATION_ID, builder.build());
    }

    private void createCallChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CALL_CHANNEL_ID, "PRIVOX incoming calls", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Incoming PRIVOX PTT user and group calls");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 300, 500});
        channel.setSound(null, null);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void showMissedCall(Map<String, String> data) {
        createMissedCallChannel();

        String callId = value(data, "callId");
        Intent openApp = new Intent(this, MainActivity.class)
            .setAction("tech.privox.ptt.OPEN_CALL." + callId)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppIntent = PendingIntent.getActivity(
            this, callId.hashCode(), openApp, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );

        String callsign = value(data, "fromCallsign");
        String groupName = value(data, "groupName");
        boolean isGroupCall = "group".equals(value(data, "kind"));
        String title = isGroupCall ? "Missed group call" : "Missed call";
        String text = callsign.isEmpty()
            ? "PRIVOX PTT"
            : (groupName.isEmpty() ? callsign : callsign + " · " + groupName);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MISSED_CALL_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory("missed_call")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(MISSED_CALL_NOTIFICATION_ID, builder.build());
    }

    private void createMissedCallChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            MISSED_CALL_CHANNEL_ID, "PRIVOX missed calls", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Missed PRIVOX PTT user and group calls");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void showIncomingMessage(Map<String, String> data) {
        createMessageChannel();

        String conversationTag = conversationTag(data);
        Intent openApp = new Intent(this, MainActivity.class)
            .setAction("tech.privox.ptt.OPEN_MESSAGE." + conversationTag)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppIntent = PendingIntent.getActivity(
            this, conversationTag.hashCode(), openApp, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );

        String callsign = value(data, "senderCallsign");
        String groupName = value(data, "groupName");
        String body = value(data, "body");
        int unreadCount = intValue(data, "unreadCount", 1);
        String title = groupName.isEmpty()
            ? (callsign.isEmpty() ? "New PRIVOX message" : callsign)
            : groupName + " · " + callsign;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MESSAGE_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(false)
            .setOnlyAlertOnce(false)
            .setNumber(unreadCount)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setContentIntent(openAppIntent);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(conversationTag, MESSAGE_NOTIFICATION_ID, builder.build());
    }

    private void createMessageChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        NotificationChannel channel = new NotificationChannel(
            MESSAGE_CHANNEL_ID, "PRIVOX messages", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("New PRIVOX text messages");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 250, 150, 250});
        channel.setSound(sound, audioAttributes);
        channel.setShowBadge(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    static String conversationTag(Map<String, String> data) {
        String groupId = value(data, "groupId");
        return groupId.isEmpty()
            ? "privox_message_direct_" + value(data, "senderId")
            : "privox_message_group_" + groupId;
    }

    private static int immutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    static String value(Map<String, String> data, String key) {
        String value = data.get(key);
        return value == null ? "" : value;
    }

    private static int intValue(Map<String, String> data, String key, int fallback) {
        try {
            return Integer.parseInt(value(data, key));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }
}
