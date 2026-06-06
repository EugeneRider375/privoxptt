package tech.privox.ptt;

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
        }
        prefs.edit().clear().apply();
        call.resolve(result);
    }
}
