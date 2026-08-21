import { useEffect, useRef, useState } from 'react';
import { PhoneCall, PhoneOff, Volume2, Ear } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useWebRTC } from '@/hooks/useWebRTC';
import { hangupCall } from '@/hooks/useSocket';
import { canRouteAudio, setAudioRoute } from '@/utils/audioRoute';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Приватный дуплексный 1:1 звонок — оба участника передают одновременно,
// без кнопки "держать, чтобы говорить". Использует тот же MediaSoup-конвейер,
// что и обычная группа, но комната — id звонка (call-join вместо join-group),
// без PTT-лока: см. server/src/socket/ptt.ts (call-join/call-hangup).
export function ActiveCallScreen() {
  const activeCall = useStore((s) => s.activeCall);
  const { startTransmitting, stopTransmitting } = useWebRTC(activeCall?.callId ?? null, 'call-join');
  const [duration, setDuration] = useState(0);
  const startedRef = useRef(false);
  // Личный звонок звучит «в ухо», как обычный телефонный. Кнопка позволяет
  // переключить на динамик — например, чтобы слышали рядом стоящие.
  const [speaker, setSpeaker] = useState(false);
  const canRoute = canRouteAudio();

  useEffect(() => {
    if (!activeCall) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    startTransmitting().catch((err) => {
      console.error('[Call] Не удалось начать передачу в звонке:', err);
    });

    // Звонок — в наушник. Ставим после старта передачи: браузер меняет
    // маршрут именно в этот момент, раньше нас всё равно бы перебило.
    setSpeaker(false);
    setAudioRoute('earpiece');

    return () => {
      stopTransmitting();
      // Возвращаем громкий режим: дальше человек снова в группе, где
      // рация должна быть слышна.
      setAudioRoute('speaker');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.callId]);

  useEffect(() => {
    if (!activeCall) { setDuration(0); return; }
    const timer = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(timer);
  }, [activeCall?.callId]);

  if (!activeCall) return null;

  const handleHangup = () => {
    hangupCall(activeCall.callId);
    // call-ended вернётся с сервера и сам почистит activeCall в сторе,
    // но локально завершаем сразу — не ждать round-trip перед закрытием UI.
    useStore.getState().setActiveCall(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ptt-dark/95 p-4">
      <div className="w-full max-w-sm border border-ptt-green/60 bg-ptt-dark shadow-2xl shadow-ptt-green/20 rounded p-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-ptt-green/60 bg-ptt-green/10">
          <PhoneCall className="h-8 w-8 text-ptt-green animate-pulse" />
        </div>
        <p className="font-mono text-ptt-green text-xs tracking-[0.25em]">DUPLEX CALL</p>
        <p className="callsign text-xl mt-2">{activeCall.otherCallsign}</p>
        <p className="font-mono text-ptt-muted text-sm mt-1">{formatDuration(duration)}</p>

        {canRoute && (
          <button
            onClick={() => {
              const next = !speaker;
              setSpeaker(next);
              setAudioRoute(next ? 'speaker' : 'earpiece');
            }}
            className="mt-5 w-full flex items-center justify-center gap-2 border border-ptt-border text-ptt-text font-mono text-xs tracking-widest rounded py-2.5 hover:text-white transition-colors"
          >
            {speaker ? <Volume2 className="w-4 h-4" /> : <Ear className="w-4 h-4" />}
            {speaker ? 'SPEAKER' : 'EARPIECE'}
          </button>
        )}

        <button
          onClick={handleHangup}
          className="mt-3 w-full flex items-center justify-center gap-2 border border-ptt-danger/60 text-ptt-danger font-mono text-xs tracking-widest rounded py-3 hover:bg-ptt-danger/10 transition-colors"
        >
          <PhoneOff className="w-4 h-4" />
          HANG UP
        </button>
      </div>
    </div>
  );
}
