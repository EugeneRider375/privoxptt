package tech.privox.ptt;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Куда направлять звук: в громкий динамик или в тихий разговорный наушник.
 *
 * Веб-часть сама этого не может: браузер переводит устройство в
 * MODE_IN_COMMUNICATION, как только одновременно работают микрофон и
 * воспроизведение, и по умолчанию уводит звук в наушник. Никакого веб-API,
 * чтобы это перебить, не существует — только нативный AudioManager.
 *
 * Отсюда два режима:
 *   speaker  — групповой канал: рацию держат в руке или в кармане, слышно
 *              должно быть всем вокруг;
 *   earpiece — личный звонок один на один: подносят к уху, как телефон.
 *
 * Браузер сбрасывает маршрут на каждом включении микрофона, поэтому режим
 * приходится переустанавливать по таймеру, а не один раз.
 */
@CapacitorPlugin(name = "PrivoxAudio")
public class PrivoxAudioPlugin extends Plugin {

    /** Как часто перебивать выбор браузера. */
    private static final long REASSERT_MS = 1500;

    private AudioManager audioManager;
    private final Handler handler = new Handler(Looper.getMainLooper());

    /** null = режим не задан, ничего не навязываем и таймер не крутим. */
    private Boolean wantSpeaker = null;

    /**
     * Виден нативному коду за пределами плагина. У T320 есть собственный цикл,
     * который держит динамик включённым всегда — во время личного звонка он
     * дрался бы с выбранным режимом. Флаг позволяет ему отступить.
     */
    private static volatile boolean earpieceRequested = false;

    public static boolean isEarpieceRequested() {
        return earpieceRequested;
    }

    private final Runnable reassert = new Runnable() {
        @Override
        public void run() {
            applyRoute();
            handler.postDelayed(this, REASSERT_MS);
        }
    };

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /**
     * mode: "speaker" | "earpiece" | "auto"
     * auto — перестать вмешиваться и отдать решение браузеру.
     */
    @PluginMethod
    public void setMode(PluginCall call) {
        final String mode = call.getString("mode", "auto");

        if ("auto".equals(mode)) {
            wantSpeaker = null;
            earpieceRequested = false;
            handler.removeCallbacks(reassert);
            if (audioManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice();
            }
            call.resolve(result("auto"));
            return;
        }

        wantSpeaker = "speaker".equals(mode);
        earpieceRequested = !wantSpeaker;
        applyRoute();

        // Перезапускаем таймер: браузер вернёт своё при следующем PTT.
        handler.removeCallbacks(reassert);
        handler.postDelayed(reassert, REASSERT_MS);

        call.resolve(result(mode));
    }

    /** Текущее состояние — чтобы веб мог показать положение переключателя. */
    @PluginMethod
    public void getMode(PluginCall call) {
        if (wantSpeaker == null) {
            call.resolve(result("auto"));
            return;
        }
        call.resolve(result(wantSpeaker ? "speaker" : "earpiece"));
    }

    /**
     * Начиная с Android 12 setSpeakerphoneOn устарел и работает наполовину:
     * динамик включить получается, а вернуть звук в наушник — нет. На таких
     * версиях устройство вывода выбирается явно, через setCommunicationDevice.
     * Отсюда две ветки: не «на всякий случай», а потому что старый способ там
     * действительно не возвращает наушник.
     */
    private void applyRoute() {
        if (audioManager == null || wantSpeaker == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            final int wanted = wantSpeaker
                ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;

            final AudioDeviceInfo current = audioManager.getCommunicationDevice();
            if (current != null && current.getType() == wanted) return;

            for (AudioDeviceInfo device : audioManager.getAvailableCommunicationDevices()) {
                if (device.getType() == wanted) {
                    audioManager.setCommunicationDevice(device);
                    return;
                }
            }
            // Наушника нет вовсе — например, планшет. Тогда оставляем как есть,
            // громкий динамик лучше тишины.
            return;
        }

        if (audioManager.isSpeakerphoneOn() != wantSpeaker) {
            audioManager.setSpeakerphoneOn(wantSpeaker);
        }
    }

    private boolean isSpeakerActive() {
        if (audioManager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            final AudioDeviceInfo current = audioManager.getCommunicationDevice();
            return current != null && current.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
        }
        return audioManager.isSpeakerphoneOn();
    }

    private JSObject result(String mode) {
        final JSObject data = new JSObject();
        data.put("mode", mode);
        data.put("speakerOn", isSpeakerActive());
        return data;
    }

    @Override
    protected void handleOnDestroy() {
        handler.removeCallbacks(reassert);
        super.handleOnDestroy();
    }
}
