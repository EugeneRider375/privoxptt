/**
 * Куда идёт звук: громкий динамик или разговорный наушник.
 *
 * Групповой канал — динамик: рацию держат в руке или в кармане, слышать
 * должны все. Личный звонок — наушник, как обычный телефонный разговор.
 *
 * Управлять этим из браузера нечем: он сам переводит устройство в режим
 * разговора и уводит звук в наушник, а веб-API, чтобы перебить, не
 * существует. Поэтому работает только внутри нашей Android-обёртки, через
 * нативный плагин. В обычном браузере и на iPhone функции просто нет — и
 * это надо честно показывать в интерфейсе, а не притворяться.
 */

export type AudioRoute = 'speaker' | 'earpiece' | 'auto';

interface PrivoxAudioPlugin {
  setMode(options: { mode: AudioRoute }): Promise<{ mode: AudioRoute; speakerOn: boolean }>;
  getMode(): Promise<{ mode: AudioRoute; speakerOn: boolean }>;
}

interface CapacitorGlobal {
  Plugins?: { PrivoxAudio?: PrivoxAudioPlugin };
}

function plugin(): PrivoxAudioPlugin | null {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.Plugins?.PrivoxAudio ?? null;
}

/** Есть ли вообще возможность управлять выводом на этом устройстве. */
export function canRouteAudio(): boolean {
  return plugin() !== null;
}

/**
 * Задать маршрут. В браузере молча ничего не делает — вызывающий код не
 * должен каждый раз проверять, где он выполняется.
 */
export async function setAudioRoute(mode: AudioRoute): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.setMode({ mode });
  } catch {
    // Не роняем разговор из-за маршрутизации: хуже тихий звук, чем обрыв.
  }
}

export async function getAudioRoute(): Promise<AudioRoute> {
  const p = plugin();
  if (!p) return 'auto';
  try {
    const result = await p.getMode();
    return result.mode;
  } catch {
    return 'auto';
  }
}
