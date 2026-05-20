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
  const compressor = ctx.createDynamicsCompressor();

  compressor.threshold.setValueAtTime(-18, now);
  compressor.knee.setValueAtTime(8, now);
  compressor.ratio.setValueAtTime(8, now);
  compressor.attack.setValueAtTime(0.003, now);
  compressor.release.setValueAtTime(0.12, now);

  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);

  [0, 0.24, 0.48, 0.82, 1.06, 1.3].forEach((offset) => {
    const highOsc = ctx.createOscillator();
    const lowOsc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + offset;
    const stop = start + 0.18;

    highOsc.type = 'square';
    highOsc.frequency.setValueAtTime(1320, start);
    highOsc.frequency.exponentialRampToValueAtTime(990, stop);

    lowOsc.type = 'triangle';
    lowOsc.frequency.setValueAtTime(660, start);
    lowOsc.frequency.exponentialRampToValueAtTime(520, stop);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.55, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    highOsc.connect(gain);
    lowOsc.connect(gain);
    gain.connect(masterGain);
    highOsc.start(start);
    lowOsc.start(start);
    highOsc.stop(stop + 0.02);
    lowOsc.stop(stop + 0.02);
  });

  masterGain.gain.setValueAtTime(1, now);
  masterGain.gain.setValueAtTime(1, now + 1.55);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.65);
  window.setTimeout(() => {
    try {
      masterGain.disconnect();
      compressor.disconnect();
    } catch {
      // Nodes may already be detached in some mobile browsers.
    }
  }, 1800);
}
