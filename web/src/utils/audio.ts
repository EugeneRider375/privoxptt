let sharedAudioCtx: AudioContext | null = null;
let lastUnlockAt = 0;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  const now = Date.now();
  if (now - lastUnlockAt < 1000) return;
  lastUnlockAt = now;

  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, start);
  gain.gain.setValueAtTime(0.0001, start);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.03);
  window.setTimeout(() => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      // Nodes may already be detached in some mobile browsers.
    }
  }, 120);
}
