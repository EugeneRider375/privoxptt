package tech.privox.ptt;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

public final class PrivoxIncomingCallRinger {
    private static final long MAX_RING_DURATION_MS = 45_000;
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static Ringtone ringtone;

    private PrivoxIncomingCallRinger() {}

    public static synchronized void start(Context context) {
        stop();

        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        Ringtone next = RingtoneManager.getRingtone(context.getApplicationContext(), uri);
        if (next == null) return;

        next.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            next.setLooping(true);
            next.setVolume(1.0f);
        }

        ringtone = next;
        next.play();
        handler.postDelayed(PrivoxIncomingCallRinger::stop, MAX_RING_DURATION_MS);
    }

    public static synchronized void stop() {
        handler.removeCallbacksAndMessages(null);
        if (ringtone != null) {
            if (ringtone.isPlaying()) ringtone.stop();
            ringtone = null;
        }
    }
}
