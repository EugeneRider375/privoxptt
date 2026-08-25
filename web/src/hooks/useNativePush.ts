import { useEffect } from 'react';
import { devicesApi } from '@/api/client';
import { useStore } from '@/store/useStore';
import { hangupCall } from './useSocket';
import { PRIVOX_MEDIA_RECOVER_EVENT } from './useWebRTC';

interface PendingCall {
  callId?: string;
  fromUserId?: string;
  fromCallsign?: string;
  fromDisplayName?: string;
  groupId?: string;
  groupName?: string;
  responseStatus?: string;
  kind?: 'user' | 'group';
}

interface PluginListenerHandle {
  remove: () => Promise<void> | void;
}

interface PrivoxPushPlugin {
  getToken: () => Promise<{ token: string }>;
  consumePendingCall: () => Promise<PendingCall>;
  clearMessageNotifications: (target: { groupId?: string; userId?: string }) => Promise<void>;
  // Только iOS — сообщить CallKit, что разговор завершён кнопкой внутри
  // приложения, иначе системный экран звонка остаётся висеть.
  endCall?: (data: { callId: string }) => Promise<void>;
  // Обратное направление: звонок завершили с нативного экрана CallKit, а не
  // кнопкой в приложении — плагин присылает это как событие, не как ответ на
  // вызов.
  addListener?: (
    eventName: string,
    callback: (data: { callId: string }) => void,
  ) => Promise<PluginListenerHandle> | PluginListenerHandle;
}

function getCapacitor(): { Plugins?: { PrivoxPush?: PrivoxPushPlugin }; getPlatform?: () => string } | undefined {
  return (window as unknown as {
    Capacitor?: { Plugins?: { PrivoxPush?: PrivoxPushPlugin }; getPlatform?: () => string };
  }).Capacitor;
}

function getNativePushPlugin(): PrivoxPushPlugin | null {
  return getCapacitor()?.Plugins?.PrivoxPush ?? null;
}

// iOS шлёт звонок через VoIP-push (PushKit), у него нет пуш-токена в обычном
// смысле — getToken() на этой платформе возвращает именно voipToken
// (см. AppDelegate.swift/PrivoxPushPlugin.swift). Android — как раньше, FCM.
function isIos(): boolean {
  return getCapacitor()?.getPlatform?.() === 'ios';
}

export async function unregisterNativePushDevice(): Promise<void> {
  const plugin = getNativePushPlugin();
  if (!plugin) return;

  const { token } = await plugin.getToken();
  if (!token) return;
  await devicesApi.unregister(isIos() ? { voipToken: token } : { pushToken: token });
}

// Кнопка HANG UP внутри приложения → сообщить CallKit, что разговор окончен.
// На Android плагин этот метод не реализует (там нет системного экрана
// звонка, нечего гасить) — тихо ничего не делаем.
export async function endNativeCall(callId: string): Promise<void> {
  const plugin = getNativePushPlugin();
  if (!plugin?.endCall || !isIos()) return;
  try {
    await plugin.endCall({ callId });
  } catch (err) {
    console.warn('[Push] endCall (CallKit) failed:', err);
  }
}

export async function clearNativeMessageNotifications(
  target: { groupId?: string; userId?: string },
): Promise<void> {
  const plugin = getNativePushPlugin();
  if (!plugin) return;
  await plugin.clearMessageNotifications(target);
}

export function useNativePush(): void {
  const accessToken = useStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken) return;
    const plugin = getNativePushPlugin();
    if (!plugin) return;

    let disposed = false;

    const consumePendingCall = async () => {
      const call = await plugin.consumePendingCall();
      if (disposed || !call.callId || !call.groupId) return;

      const state = useStore.getState();

      // Индивидуальный звонок (kind: 'user'), отвеченный через нативный
      // CallKit-экран, пока приложение было выгружено/в фоне: событие
      // call-connected от сервера в этот момент ушло в пустоту — сокет ещё
      // не был подключён, когда сервер его разослал (см. calls.ts). Поэтому
      // ActiveCallScreen тут восстанавливается из данных самого push, а не
      // ждёт повторной доставки события, которой не будет.
      if (call.kind === 'user' && call.responseStatus === 'answered') {
        state.setActiveCall({
          callId: call.callId,
          otherUserId: call.fromUserId ?? '',
          otherCallsign: call.fromCallsign ?? '',
        });
        return;
      }

      state.setActiveGroup(call.groupId);
      window.setTimeout(() => {
        window.dispatchEvent(new Event(PRIVOX_MEDIA_RECOVER_EVENT));
      }, 0);
      if (call.responseStatus === 'answered') {
        if (!window.location.pathname.startsWith('/radio')) {
          window.location.assign('/radio');
        }
        return;
      }
      state.addAlert({
        type: 'info',
        variant: 'user-call',
        callsign: call.fromCallsign,
        groupName: call.groupName,
        groupId: call.groupId,
        callId: call.callId,
        callKind: call.kind ?? 'user',
        message: `${call.fromCallsign || 'PRIVOX user'} calls you in ${call.groupName || 'a group'}`,
      });

      if (!window.location.pathname.startsWith('/radio')) {
        window.location.assign('/radio');
      }
    };

    const register = async () => {
      try {
        const { token } = await plugin.getToken();
        if (!token || disposed) return;
        const ios = isIos();
        await devicesApi.register({
          ...(ios ? { voipToken: token } : { pushToken: token }),
          platform: ios ? 'IOS' : 'ANDROID',
          deviceName: navigator.userAgent.slice(0, 120),
          appVersion: '1.0',
        });
        await consumePendingCall();
      } catch (err) {
        console.warn('[Push] Native push registration failed:', err);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        consumePendingCall().catch((err) => {
          console.warn('[Push] Pending call restore failed:', err);
        });
      }
    };

    // Разговор завершили с нативного экрана CallKit (не кнопкой в
    // приложении) — сами мы об этом не узнаем без этой подписки: у WebView
    // нет доступа к системным событиям звонка. Дальше — тот же путь, что и
    // для HANG UP внутри приложения: сообщить серверу (иначе собеседник
    // останется "на линии") и убрать ActiveCallScreen локально.
    let removeCallEndedListener: (() => void) | undefined;
    if (plugin.addListener) {
      Promise.resolve(
        plugin.addListener('callEndedNatively', ({ callId }) => {
          const current = useStore.getState().activeCall;
          if (current?.callId !== callId) return;
          hangupCall(callId);
          useStore.getState().setActiveCall(null);
        }),
      )
        .then((handle) => { removeCallEndedListener = () => handle.remove(); })
        .catch((err) => console.warn('[Push] Failed to subscribe to callEndedNatively:', err));
    }

    register();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
      removeCallEndedListener?.();
    };
  }, [accessToken]);
}
