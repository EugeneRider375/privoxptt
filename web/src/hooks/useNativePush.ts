import { useEffect } from 'react';
import { devicesApi } from '@/api/client';
import { useStore } from '@/store/useStore';

interface PendingCall {
  callId?: string;
  fromCallsign?: string;
  fromDisplayName?: string;
  groupId?: string;
  groupName?: string;
}

interface PrivoxPushPlugin {
  getToken: () => Promise<{ token: string }>;
  consumePendingCall: () => Promise<PendingCall>;
}

function getNativePushPlugin(): PrivoxPushPlugin | null {
  const capacitor = (window as unknown as {
    Capacitor?: { Plugins?: { PrivoxPush?: PrivoxPushPlugin } };
  }).Capacitor;
  return capacitor?.Plugins?.PrivoxPush ?? null;
}

export async function unregisterNativePushDevice(): Promise<void> {
  const plugin = getNativePushPlugin();
  if (!plugin) return;

  const { token } = await plugin.getToken();
  if (token) {
    await devicesApi.unregister(token);
  }
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
      state.setActiveGroup(call.groupId);
      state.addAlert({
        type: 'info',
        variant: 'user-call',
        callsign: call.fromCallsign,
        groupName: call.groupName,
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
        await devicesApi.register({
          pushToken: token,
          platform: 'ANDROID',
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
