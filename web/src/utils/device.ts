// Detects whether the web app is running inside the Inrico T320 native wrapper.
// The wrapper appends "PrivoxT320" to the WebView User-Agent (Capacitor
// appendUserAgentString). Used to enable radio-specific behaviour (louder mic,
// D-pad list UI) without affecting the phone experience.
export function isRadioDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /PrivoxT320/i.test(navigator.userAgent);
}

// D57 — running inside the native iOS Capacitor app (not Safari/PWA). On
// this platform CallKit already fully drives incoming individual/group
// calls (ring, answer, audio session) via PushKit — the in-app JS
// incoming-call popup must stay out of its way there, or both UIs show up
// at once and the JS-answered path never triggers CallKit's own audio
// session activation, leaving the call silent. Android has no CallKit
// equivalent in this project, so it keeps using the JS popup as before.
export function isNativeIosApp(): boolean {
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return capacitor?.getPlatform?.() === 'ios';
}
