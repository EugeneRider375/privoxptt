import { useCallback, useRef, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { useSocket } from './useSocket';
import { useWebRTC, unlockAudio } from './useWebRTC';

const WEBRTC_TIMEOUT_MS = 8_000;
const MIC_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
  },
};

function getPttErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'Microphone permission is blocked. Allow microphone access for this site and try again.';
  }
  if (err instanceof DOMException && err.name === 'NotFoundError') {
    return 'No microphone was found on this device.';
  }
  if (err instanceof Error && /not allowed|permission|denied/i.test(err.message)) {
    return 'Microphone permission is blocked. Allow microphone access for this site and try again.';
  }
  return `PTT error: ${err instanceof Error ? err.message : 'unknown error'}`;
}

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
        message: 'Microphone is unavailable. Open the app over HTTPS.',
      });
      return;
    }

    // Разблокируем AudioContext в контексте user-gesture (чтобы слушающая сторона тоже могла воспроизводить)
    unlockAudio().catch(() => {});

    isPressing.current = true;
    const seq = ++pressSeq.current;

    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia(MIC_AUDIO_CONSTRAINTS);
    } catch (err) {
      console.error('[PTT] Microphone permission failed:', err);
      isPressing.current = false;
      useStore.getState().addAlert({
        type: 'warn',
        message: getPttErrorMessage(err),
      });
      return;
    }

    if (!isPressing.current || pressSeq.current !== seq) {
      micStream.getTracks().forEach((track) => track.stop());
      return;
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('WebRTC timeout')), WEBRTC_TIMEOUT_MS)
    );

    pttStart(groupId);

    try {
      await Promise.race([startTransmitting(micStream), timeout]);
      if (!isPressing.current || pressSeq.current !== seq) {
        stopTransmitting();
        pttStop(groupId);
        useStore.getState().setPttStatus('idle');
        return;
      }
      const { user, setPttStatus } = useStore.getState();
      setPttStatus('transmitting', groupId, user?.id, user?.callsign);
    } catch (err) {
      console.error('[PTT] Failed to start transmission:', err);
      stopTransmitting();
      pttStop(groupId);
      isPressing.current = false;
      useStore.getState().addAlert({
        type: 'warn',
        message: getPttErrorMessage(err),
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

    window.addEventListener('pagehide', stopIfActive);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', stopIfActive);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [stopPtt]);

  return { startPtt, stopPtt, isTransmitting: pttStatus === 'transmitting', pttStatus };
}
