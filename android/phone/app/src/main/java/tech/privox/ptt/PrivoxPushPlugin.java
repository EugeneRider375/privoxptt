package tech.privox.ptt;

import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name = "PrivoxPush")
public class PrivoxPushPlugin extends Plugin {
    static final String PREFS_NAME = "privox_push";
    static final String KEY_CALL_ID = "call_id";
    static final String KEY_FROM_CALLSIGN = "from_callsign";
    static final String KEY_FROM_DISPLAY_NAME = "from_display_name";
    static final String KEY_GROUP_ID = "group_id";
    static final String KEY_GROUP_NAME = "group_name";
    static final String KEY_CREATED_AT = "created_at";
    static final String KEY_RESPONSE_URL = "response_url";
    static final String KEY_RESPONSE_TOKEN = "response_token";
    static final String KEY_RESPONSE_STATUS = "response_status";
    static final String KEY_CALL_KIND = "call_kind";

    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                call.reject("Unable to obtain Firebase token", task.getException());
                return;
            }
            JSObject result = new JSObject();
            result.put("token", task.getResult());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void consumePendingCall(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String callId = prefs.getString(KEY_CALL_ID, null);
        JSObject result = new JSObject();
        long createdAt = prefs.getLong(KEY_CREATED_AT, 0);
        if (callId != null && System.currentTimeMillis() - createdAt <= 60_000) {
            result.put("callId", callId);
            result.put("fromCallsign", prefs.getString(KEY_FROM_CALLSIGN, ""));
            result.put("fromDisplayName", prefs.getString(KEY_FROM_DISPLAY_NAME, ""));
            result.put("groupId", prefs.getString(KEY_GROUP_ID, ""));
            result.put("groupName", prefs.getString(KEY_GROUP_NAME, ""));
            result.put("responseStatus", prefs.getString(KEY_RESPONSE_STATUS, ""));
            result.put("kind", prefs.getString(KEY_CALL_KIND, "user"));
        }
        prefs.edit().clear().apply();
        call.resolve(result);
    }

    @PluginMethod
    public void clearMessageNotifications(PluginCall call) {
        String groupId = call.getString("groupId", "");
        String userId = call.getString("userId", "");
        if (groupId.isEmpty() && userId.isEmpty()) {
            call.reject("groupId or userId is required");
            return;
        }

        String tag = groupId.isEmpty()
            ? "privox_message_direct_" + userId
            : "privox_message_group_" + groupId;
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(tag, PrivoxFirebaseMessagingService.MESSAGE_NOTIFICATION_ID);
        }
        call.resolve();
    }
}
