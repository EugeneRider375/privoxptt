// Detects whether the web app is running inside the Inrico T320 native wrapper.
// The wrapper appends "PrivoxT320" to the WebView User-Agent (Capacitor
// appendUserAgentString). Used to enable radio-specific behaviour (louder mic,
// D-pad list UI) without affecting the phone experience.
export function isRadioDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /PrivoxT320/i.test(navigator.userAgent);
}
