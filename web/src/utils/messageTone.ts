import { getAudioContext, unlockAudio } from './audio';

// D45 — было 4 быстрых прямоугольных бипа с восходящим свистом на каждом:
// звучало как тревога пейджера, тестировщик попросил "мелодичнее" (форма
// сбора идей, 2026-08-31). Заменено на мягкий двухнотный "дзинь" на чистых
// синусоидах (как у большинства мессенджеров) — без square/triangle волн и
// без свиста внутри ноты.
const CHORD_NOTES = [1046.5, 1318.51]; // C6, E6 — приятный мажорный терц
const NOTE_ATTACK_S = 0.012;
const NOTE_DECAY_S = 0.42;

export async function playMessageTone() {
  await unlockAudio();
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(60); // короткий одиночный импульс — не имитируем тревогу
    } catch {
      // Vibration can be blocked by the browser or device policy.
    }
  }

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.5, now);
  masterGain.connect(ctx.destination);

  const nodes: AudioNode[] = [masterGain];
  CHORD_NOTES.forEach((freq, index) => {
    const start = now + index * 0.09; // вторая нота чуть позже первой, внахлёст
    const stop = start + NOTE_DECAY_S;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.9, start + NOTE_ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(start);
    oscillator.stop(stop + 0.02);
    nodes.push(oscillator, gain);
  });

  window.setTimeout(() => {
    try {
      nodes.forEach((node) => node.disconnect());
    } catch {
      // Nodes may already be detached in some mobile browsers.
    }
  }, (NOTE_DECAY_S + 0.3) * 1000);
}
