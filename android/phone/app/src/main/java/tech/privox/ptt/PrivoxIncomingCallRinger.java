package tech.privox.ptt;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

public final class PrivoxIncomingCallRinger {
    private static final String TAG = "PrivoxRinger";
    private static final long MAX_RING_DURATION_MS = 45_000;
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static Ringtone ringtone;

    private PrivoxIncomingCallRinger() {}

    public static synchronized void start(Context context) {
        stop();

        warnIfSilent(context);

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

    /**
     * Нулевая громкость звонка = беззвучный вызов при любом рингтоне.
     *
     * 21.08.2026 на это ушёл час разбирательств: экран входящего появлялся,
     * вибрация была, а звука не было — и в logcat при этом висело безобидное
     * предупреждение MIUI «Couldn't open ringtone_cache», которое сбивало с
     * толку (Ringtone его переживает и играет запасной источник). Настоящей
     * причиной была громкость STREAM_RING = 0. Эта строка в логе делает
     * следующую такую диагностику мгновенной.
     *
     * Громкость намеренно не поднимаем: беззвучный режим — выбор человека.
     */
    private static void warnIfSilent(Context context) {
        try {
            AudioManager audio =
                (AudioManager) context.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
            if (audio != null && audio.getStreamVolume(AudioManager.STREAM_RING) == 0) {
                Log.w(TAG, "Громкость звонка = 0: вызов будет беззвучным при любом рингтоне");
            }
        } catch (Exception ignored) {
            // Диагностика не повод ронять звонок.
        }
    }

    public static synchronized void stop() {
        handler.removeCallbacksAndMessages(null);
        if (ringtone != null) {
            if (ringtone.isPlaying()) ringtone.stop();
            ringtone = null;
        }
    }
}
