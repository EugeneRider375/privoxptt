package tech.privox.ptt;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Поднимает приложение вместе с системой: включил рацию — и она в эфире, без
 * единого касания. Сессия живёт в localStorage WebView и переживает выключение
 * питания, так что логин при этом не спрашивается.
 *
 * Ловим не только штатный BOOT_COMPLETED: на прошивках MTK (а T320 именно
 * такая) «быстрая загрузка» рассылает вместо него QUICKBOOT_POWERON.
 *
 * Запуск Activity прямо из ресивера легален на Android 8.1 — ограничения на
 * фоновый старт активностей появились только в Android 10, а устройство
 * заведомо старше.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        final String action = intent.getAction();
        final boolean isBoot =
            Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action);

        if (!isBoot) {
            return;
        }

        android.util.Log.d("PrivoxPTT", "BootReceiver: " + action + " -> запускаю приложение");

        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launch);
    }
}
