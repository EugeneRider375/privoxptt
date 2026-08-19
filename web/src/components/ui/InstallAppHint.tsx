import { useState } from 'react';
import { Download, X } from 'lucide-react';

import { isRadioDevice } from '@/utils/device';

/**
 * Напоминание поставить приложение — для тех, кто вошёл по ссылке и остался
 * в браузере.
 *
 * Кнопка «скачать» есть на странице приглашения, но она видна ровно один раз:
 * человек нажимает «в группу», попадает в эфир и больше о приложении не
 * слышит. А в браузере на Android нет ни работы при выключенном экране, ни
 * входящих вызовов — то есть он остаётся на слабом варианте, не зная об этом.
 *
 * Показывается только там, где имеет смысл: Android, снаружи нашей обёртки,
 * и пока человек сам не закрыл подсказку.
 */

const DISMISS_KEY = 'privox.installHintDismissed';
const APK_URL = '/downloads/privox-ptt-android.apk';

function shouldShow(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (localStorage.getItem(DISMISS_KEY) === '1') return false;

  const ua = navigator.userAgent;
  // Внутри обёртки предлагать установку незачем — она уже установлена.
  const insideApp = /wv|PrivoxT320/i.test(ua) || isRadioDevice();
  return /Android/i.test(ua) && !insideApp;
}

export function InstallAppHint() {
  const [visible, setVisible] = useState(shouldShow);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  }

  return (
    <div className="mx-3 mb-2 rounded border border-ptt-blue/40 bg-ptt-blue/10 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-ptt-blue text-[11px] tracking-widest">ANDROID APP AVAILABLE</p>
          <p className="font-mono text-ptt-muted text-[11px] mt-1">
            In the browser PRIVOX stops when the screen goes off. The app keeps listening and rings on incoming
            calls.
          </p>
          <a
            href={APK_URL}
            download
            className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-ptt-blue hover:text-white"
          >
            <Download className="w-3 h-3" /> Install the app
          </a>
        </div>
        <button onClick={dismiss} title="Don't show again" className="text-ptt-muted hover:text-white shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
