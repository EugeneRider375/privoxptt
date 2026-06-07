import { getAudioContext, unlockAudio } from './audio';

export async function playMessageTone() {
  await unlockAudio();
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([90, 70, 90]);
    } catch {
      // Vibration can be blocked by the browser or device policy.
    }
  }

  [0, 0.16, 0.32].forEach((offset) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + offset;
    const stop = start + 0.11;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.exponentialRampToValueAtTime(1320, stop);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(stop + 0.02);
  });
}
