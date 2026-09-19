import { useEffect, useRef } from 'react';
import { PhoneCall, PhoneOff } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { hangupCall } from '@/hooks/useSocket';
import { startRingback } from '@/utils/ringbackTone';

/**
 * D66 — раньше, пока звонок ещё не приняли, у звонящего вообще не было
 * никакого экрана: `ActiveCallScreen` появляется только по `call-connected`
 * (то есть уже ПОСЛЕ ответа), а до этого была лишь маленькая мигающая
 * иконка телефона в списке участников — легко не заметить, никакого
 * гудка. Бэкенд уже полностью отслеживал статус (`ringing`/`answered`/
 * `declined`/`timeout`, `server/src/services/calls.ts`) — не хватало
 * только самого экрана и звука на этой стороне.
 *
 * `outgoingUserCalls` в сторе уже хранит эту историю (D-код не менялся);
 * достаточно найти самую свежую запись в статусе `ringing` — звонить
 * второй раз, пока первый ещё не завершён, UI и так не даёт
 * (`UserRadioPage`/`DispatcherDashboard` блокируют кнопку, пока
 * `callingUserId` не сброшен).
 */
export function OutgoingCallScreen() {
  const outgoingUserCalls = useStore((s) => s.outgoingUserCalls);
  const activeCall = useStore((s) => s.activeCall);
  const ringingCall = outgoingUserCalls.find((c) => c.kind === 'user' && c.status === 'ringing');
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!ringingCall) return;
    let stopped = false;
    startRingback().then((stop) => {
      if (stopped) { stop(); return; }
      stopRef.current = stop;
    });
    return () => {
      stopped = true;
      stopRef.current?.();
      stopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringingCall?.callId]);

  // call-connected мог прийти раньше или позже user-call-status='answered' —
  // не показываем экран "звоним", если разговор уже идёт (ActiveCallScreen).
  if (!ringingCall || activeCall) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ptt-dark/95 p-4">
      <div className="w-full max-w-sm border border-ptt-blue/60 bg-ptt-dark shadow-2xl shadow-ptt-blue/20 rounded p-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-ptt-blue/60 bg-ptt-blue/10">
          <PhoneCall className="h-8 w-8 text-ptt-blue animate-pulse" />
        </div>
        <p className="font-mono text-ptt-blue text-xs tracking-[0.25em]">CALLING</p>
        <p className="callsign text-xl mt-2">{ringingCall.targetCallsign}</p>
        <p className="font-mono text-ptt-muted text-sm mt-1">{ringingCall.groupName}</p>

        <button
          onClick={() => hangupCall(ringingCall.callId)}
          className="mt-5 w-full flex items-center justify-center gap-2 border border-ptt-danger/60 text-ptt-danger font-mono text-xs tracking-widest rounded py-3 hover:bg-ptt-danger/10 transition-colors"
        >
          <PhoneOff className="w-4 h-4" />
          CANCEL
        </button>
      </div>
    </div>
  );
}
