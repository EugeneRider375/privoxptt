import { getAudioContext, unlockAudio } from './audio';

export async function playUserCallTone() {
  await unlockAudio();
  const ctx = getAudioContext();

  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([180, 80, 180]);
    } catch {
      // Some browsers expose vibrate but block it in the current context.
    }
  }

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.connect(ctx.destination);

  [0, 0.26, 0.52].forEach((offset) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + offset;
    const stop = start + 0.16;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, start);
    osc.frequency.exponentialRampToValueAtTime(660, stop);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(start);
    osc.stop(stop + 0.02);
  });

  masterGain.gain.setValueAtTime(0.9, now);
  masterGain.gain.setValueAtTime(0.9, now + 0.7);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.78);
  window.setTimeout(() => masterGain.disconnect(), 900);
}
