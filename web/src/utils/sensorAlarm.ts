import { getAudioContext, unlockAudio } from './audio';

// Тревожная сирена датчика (~4с) для диспетчера: волнообразный «вой» пилообразного тона,
// гуляющий 660↔1320 Гц. Без файлов — целиком на осцилляторе, как остальные тоны проекта.
export async function playSensorAlarm() {
  await unlockAudio();
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([300, 120, 300, 120, 300, 120, 300]);
    } catch {
      // Vibration can be blocked by the browser or device policy.
    }
  }

  const DURATION = 4; // секунды
  const SWEEP = 0.5; // период «вверх-вниз»

  const masterGain = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-18, now);
  compressor.knee.setValueAtTime(10, now);
  compressor.ratio.setValueAtTime(12, now);
  compressor.attack.setValueAtTime(0.003, now);
  compressor.release.setValueAtTime(0.15, now);
  masterGain.gain.setValueAtTime(0.9, now);
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  for (let t = 0; t < DURATION; t += SWEEP) {
    osc.frequency.setValueAtTime(660, now + t);
    osc.frequency.exponentialRampToValueAtTime(1320, now + t + SWEEP / 2);
    osc.frequency.exponentialRampToValueAtTime(660, now + t + SWEEP);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
  gain.gain.setValueAtTime(0.6, now + DURATION - 0.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + DURATION);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + DURATION + 0.05);

  window.setTimeout(() => {
    try {
      masterGain.disconnect();
      compressor.disconnect();
    } catch {
      // Nodes may already be detached in some mobile browsers.
    }
  }, (DURATION + 0.3) * 1000);
}
