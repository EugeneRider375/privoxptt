import { useCallback, useRef, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { useSocket } from './useSocket';
import { useWebRTC, unlockAudio } from './useWebRTC';

const WEBRTC_TIMEOUT_MS = 8_000;

export function usePTT(groupId: string | null) {
  const pttStatus = useStore((s) => s.pttStatus);
  const isPressing = useRef(false);
  const pressSeq = useRef(0);

  const { pttStart, pttStop } = useSocket();
  const { startTransmitting, stopTransmitting } = useWebRTC(groupId);

  const startPtt = useCallback(async () => {
    if (!groupId || isPressing.current) return;
    const { pttStatus: status } = useStore.getState();
    if (status === 'receiving') return;

    if (!navigator.mediaDevices?.getUserMedia) {
      useStore.getState().addAlert({
        type: 'error',
        message: 'Микрофон недоступен. Откройте через HTTPS.',
      });
      return;
    }

    // Разблокируем AudioContext в контексте user-gesture (чтобы слушающая сторона тоже могла воспроизводить)
    unlockAudio().catch(() => {});

    isPressing.current = true;
    const seq = ++pressSeq.current;
    pttStart(groupId);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('WebRTC timeout')), WEBRTC_TIMEOUT_MS)
    );

    try {
      await Promise.race([startTransmitting(), timeout]);
      if (!isPressing.current || pressSeq.current !== seq) {
        stopTransmitting();
        pttStop(groupId);
        useStore.getState().setPttStatus('idle');
        return;
      }
      const { user, setPttStatus } = useStore.getState();
      setPttStatus('transmitting', groupId, user?.id, user?.callsign);
    } catch (err) {
      console.error('[PTT] Ошибка запуска передачи:', err);
      stopTransmitting();
      pttStop(groupId);
      isPressing.current = false;
      useStore.getState().addAlert({
        type: 'warn',
        message: `Ошибка PTT: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
      });
    }
  }, [groupId, pttStart, pttStop, startTransmitting]);

  const stopPtt = useCallback(() => {
    if (!groupId || !isPressing.current) return;
    isPressing.current = false;
    pressSeq.current += 1;
    stopTransmitting();
    pttStop(groupId);
    useStore.getState().setPttStatus('idle');
  }, [groupId, pttStop, stopTransmitting]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        startPtt();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); stopPtt(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startPtt, stopPtt]);

  useEffect(() => {
    return () => { if (isPressing.current) stopPtt(); };
  }, [stopPtt]);

  useEffect(() => {
    const stopIfActive = () => {
      if (isPressing.current) stopPtt();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopIfActive();
    };

    window.addEventListener('blur', stopIfActive);
    window.addEventListener('pagehide', stopIfActive);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', stopIfActive);
      window.removeEventListener('pagehide', stopIfActive);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [stopPtt]);

  return { startPtt, stopPtt, isTransmitting: pttStatus === 'transmitting', pttStatus };
}
