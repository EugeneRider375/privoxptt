import { getAudioContext, unlockAudio } from './audio';

// D66 — гудок ожидания у звонящего, пока абонент не ответил. Не путать с
// playUserCallTone (callTone.ts) — тот одноразовый, звучит у ПОЛУЧАТЕЛЯ на
// входящий звонок. Здесь — зацикленный классический "би-би... пауза",
// звучит у ЗВОНЯЩЕГО, пока статус звонка 'ringing'.

const RING_ON_MS = 1200;
const RING_OFF_MS = 3000;

function playRingBurst(ctx: AudioContext) {
  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.35, now);
  masterGain.connect(ctx.destination);

  // Два коротких тона подряд — узнаваемый паттерн гудка "вызов идёт".
  [0, 0.5].forEach((offset) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(1, now + offset + 0.02);
    gain.gain.setValueAtTime(1, now + offset + 0.38);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.4);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now + offset);
    osc.stop(now + offset + 0.42);
  });

  setTimeout(() => {
    try { masterGain.disconnect(); } catch {
      // Nodes may already be detached in some mobile browsers.
    }
  }, RING_ON_MS + 100);
}

/** Запускает зацикленный гудок. Возвращает функцию остановки — вызвать её
 * при ответе/отбое/отмене, иначе гудок будет звучать бесконечно. */
export async function startRingback(): Promise<() => void> {
  await unlockAudio();
  const ctx = getAudioContext();
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function tick() {
    if (stopped) return;
    playRingBurst(ctx);
    timeoutId = setTimeout(tick, RING_ON_MS + RING_OFF_MS);
  }
  tick();

  return () => {
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
  };
}
