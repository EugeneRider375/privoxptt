import { useEffect } from 'react';
import { devicesApi } from '@/api/client';
import { useStore } from '@/store/useStore';
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

interface PrivoxPushPlugin {
  getToken: () => Promise<{ token: string }>;
  consumePendingCall: () => Promise<PendingCall>;
  clearMessageNotifications: (target: { groupId?: string; userId?: string }) => Promise<void>;
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

    register();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, [accessToken]);
}
