import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Download, Loader2, Radio, Smartphone } from 'lucide-react';

import { invitesApi } from '@/api/client';
import { PrivoxLogo } from '@/components/brand/PrivoxLogo';
import { useStore } from '@/store/useStore';
import { isRadioDevice } from '@/utils/device';
import type { User } from '@/types';

/**
 * Страница, куда ведёт персональный QR: /join/<токен>.
 *
 * Смысл — человек не вводит ничего. Он видит своё имя и группу, подтверждает,
 * и оказывается в эфире. Логин с паролем остаются резервным способом.
 *
 * Открывается и в браузере, и внутри Android-обёртки: приложение грузит тот же
 * сайт, так что страница одна на всех.
 */

interface InviteInfo {
  valid: boolean;
  state: string;
  user: { callsign: string; displayName: string; login: string | null };
  organization: { id: string; name: string; slug: string };
  group: { name: string; color: string } | null;
  expiresAt: string;
  alreadyActivated: boolean;
}

/**
 * Ссылка на APK — только для Android и только когда мы ещё в браузере.
 * Указывает на тот же файл, что и остальной сайт: раньше здесь стоял
 * privox-ptt-android-debug.apk, которого на сервере нет, и кнопка со страницы
 * приглашения отдавала 404 — человек сканировал QR и упирался в ошибку.
 */
const ANDROID_APK_URL = '/downloads/privox-ptt-android.apk';

// Публичная ссылка TestFlight появляется после первой заливки сборки в
// App Store Connect (Xcode → Archive → Distribute → TestFlight, затем
// TestFlight → App Store Connect → Public Link). См. D23 в BACKLOG_RU.md.
// Пока пусто — блок ниже просто не показывается, ничего не ломает.
const IOS_TESTFLIGHT_URL = '';

function isAndroidBrowser(): boolean {
  const ua = navigator.userAgent;
  // Внутри нашей обёртки предлагать установку незачем — она уже установлена.
  const insideApp = /wv|PrivoxT320/i.test(ua) || isRadioDevice();
  return /Android/i.test(ua) && !insideApp;
}

function isIosBrowser(): boolean {
  const ua = navigator.userAgent;
  // У iOS-обёртки (Capacitor WKWebView) UA не содержит "wv" как у Android —
  // отличаем по наличию самого моста Capacitor в window.
  const insideApp = !!(window as unknown as { Capacitor?: unknown }).Capacitor;
  return /iPhone|iPad|iPod/i.test(ua) && !insideApp;
}

export function JoinPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);
  const currentUser = useStore((s) => s.user);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    invitesApi
      .resolve(token)
      .then((data: InviteInfo) => { if (!cancelled) setInfo(data); })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error ?? 'Could not open this invitation');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  async function handleActivate() {
    setActivating(true);
    setError('');
    try {
      const data = await invitesApi.activate(token);
      setAuth(data.user as User, data.accessToken, data.refreshToken);

      const role = data.user.role;
      if (role === 'USER') navigate('/radio');
      else if (role === 'DISPATCHER') navigate('/dispatcher');
      else navigate('/admin');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Activation failed');
      setActivating(false);
    }
  }

  return (
    <div className="min-h-screen bg-ptt-dark flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ptt-card border border-ptt-border mb-3 overflow-hidden">
            <PrivoxLogo className="h-full w-full rounded-2xl" markClassName="h-10 w-10" />
          </div>
          <p className="font-orbitron text-white text-lg tracking-widest">
            PRIVOX<span className="text-ptt-green">PTT</span>
          </p>
        </div>

        <div className="card p-5">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-6 h-6 text-ptt-green animate-spin" />
              <p className="font-mono text-ptt-muted text-xs">Checking invitation…</p>
            </div>
          )}

          {/* Приглашение непригодно — говорим почему и куда идти. */}
          {!loading && !info?.valid && (
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-ptt-danger shrink-0 mt-0.5" />
                <div>
                  <p className="font-rajdhani font-bold text-white">Invitation cannot be used</p>
                  <p className="font-mono text-ptt-muted text-xs mt-1">{error || 'This link is not valid'}</p>
                </div>
              </div>
              <p className="font-mono text-ptt-muted text-[11px]">
                Ask your administrator to send a new invitation. If you already have a login and password, sign in
                as usual.
              </p>
              <Link to="/login"
                className="block w-full text-center bg-ptt-green text-ptt-dark font-orbitron text-xs py-2.5 rounded tracking-widest">
                SIGN IN
              </Link>
            </div>
          )}

          {/* Приглашение годное — показываем, кто и куда. */}
          {!loading && info?.valid && (
            <div className="space-y-4">
              <div className="text-center">
                <p className="font-mono text-ptt-muted text-[11px] tracking-widest">YOU ARE</p>
                <p className="callsign text-2xl mt-1">{info.user.callsign}</p>
                {/* Имя печатаем только если оно отличается от позывного —
                    у массово созданных участников они совпадают. */}
                {info.user.displayName !== info.user.callsign && (
                  <p className="font-rajdhani text-ptt-text text-sm">{info.user.displayName}</p>
                )}
              </div>

              {info.group && (
                <div className="rounded border border-ptt-border bg-ptt-dark p-3 flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: info.group.color }} />
                  <div className="min-w-0">
                    <p className="font-rajdhani font-bold text-white truncate">{info.group.name}</p>
                    <p className="font-mono text-ptt-muted text-[11px] truncate">{info.organization.name}</p>
                  </div>
                </div>
              )}

              {/* Уже вошли под другим именем — предупреждаем, иначе человек
                  подумает, что приложение сломалось. */}
              {currentUser && currentUser.callsign !== info.user.callsign && (
                <p className="font-mono text-ptt-warn text-[11px]">
                  You are signed in as {currentUser.callsign}. Continuing will switch this device to{' '}
                  {info.user.callsign}.
                </p>
              )}

              {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}

              <button
                onClick={handleActivate}
                disabled={activating}
                className="w-full flex items-center justify-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-sm py-3 rounded tracking-widest disabled:opacity-50"
              >
                {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                {activating ? 'CONNECTING…' : 'JOIN THE GROUP'}
              </button>

              <p className="font-mono text-ptt-muted text-[11px] text-center">
                No password needed. Your microphone will be requested once.
              </p>

              {/* Android: приложение удобнее браузера — фоновая работа и вызовы. */}
              {isAndroidBrowser() && (
                <div className="pt-3 border-t border-ptt-border space-y-2">
                  <p className="flex items-center gap-2 font-mono text-ptt-text text-[11px]">
                    <Smartphone className="w-3.5 h-3.5" /> Using an Android phone?
                  </p>
                  <p className="font-mono text-ptt-muted text-[11px]">
                    The app keeps working with the screen off and rings on incoming calls. Install it, then open this
                    same link again — the invitation stays valid.
                  </p>
                  <a href={ANDROID_APK_URL}
                    className="flex items-center justify-center gap-2 border border-ptt-border text-ptt-text font-mono text-xs py-2 rounded hover:text-white">
                    <Download className="w-3 h-3" /> DOWNLOAD ANDROID APP
                  </a>
                </div>
              )}

              {/* iPhone: то же самое, но через TestFlight — Apple не даёт
                  ставить .ipa напрямую с сайта, как APK на Android. */}
              {isIosBrowser() && IOS_TESTFLIGHT_URL && (
                <div className="pt-3 border-t border-ptt-border space-y-2">
                  <p className="flex items-center gap-2 font-mono text-ptt-text text-[11px]">
                    <Smartphone className="w-3.5 h-3.5" /> Using an iPhone?
                  </p>
                  <p className="font-mono text-ptt-muted text-[11px]">
                    The app rings on incoming calls even with the screen locked. Install it via TestFlight, then open
                    this same link again — the invitation stays valid.
                  </p>
                  <a href={IOS_TESTFLIGHT_URL}
                    className="flex items-center justify-center gap-2 border border-ptt-border text-ptt-text font-mono text-xs py-2 rounded hover:text-white">
                    <Download className="w-3 h-3" /> INSTALL VIA TESTFLIGHT
                  </a>
                </div>
              )}

              {/* Резервный путь — на случай, если QR протух или сменился телефон. */}
              {info.user.login && (
                <p className="font-mono text-ptt-muted text-[11px] text-center pt-2 border-t border-ptt-border">
                  Backup sign-in: login <span className="text-ptt-text">{info.user.login}</span>{' '}
                  <Link to="/login" className="text-ptt-blue hover:text-white inline-flex items-center gap-1">
                    open form <ArrowRight className="w-3 h-3" />
                  </Link>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
