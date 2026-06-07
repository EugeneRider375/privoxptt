import { getAudioContext, unlockAudio } from './audio';

export async function playMessageTone() {
  await unlockAudio();
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([140, 80, 140, 80, 220]);
    } catch {
      // Vibration can be blocked by the browser or device policy.
    }
  }

  const masterGain = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();

  compressor.threshold.setValueAtTime(-20, now);
  compressor.knee.setValueAtTime(10, now);
  compressor.ratio.setValueAtTime(10, now);
  compressor.attack.setValueAtTime(0.003, now);
  compressor.release.setValueAtTime(0.15, now);

  masterGain.gain.setValueAtTime(1, now);
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);

  [0, 0.22, 0.44, 0.78].forEach((offset, index) => {
    const highOscillator = ctx.createOscillator();
    const lowOscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + offset;
    const stop = start + (index === 3 ? 0.24 : 0.16);

    highOscillator.type = 'square';
    highOscillator.frequency.setValueAtTime(1180, start);
    highOscillator.frequency.exponentialRampToValueAtTime(1540, stop);

    lowOscillator.type = 'triangle';
    lowOscillator.frequency.setValueAtTime(590, start);
    lowOscillator.frequency.exponentialRampToValueAtTime(770, stop);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.7, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    highOscillator.connect(gain);
    lowOscillator.connect(gain);
    gain.connect(masterGain);
    highOscillator.start(start);
    lowOscillator.start(start);
    highOscillator.stop(stop + 0.02);
    lowOscillator.stop(stop + 0.02);
  });

  window.setTimeout(() => {
    try {
      masterGain.disconnect();
      compressor.disconnect();
    } catch {
      // Nodes may already be detached in some mobile browsers.
    }
  }, 1300);
}
