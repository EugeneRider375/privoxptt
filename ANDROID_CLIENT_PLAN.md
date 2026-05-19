# Android Client Plan

Date: 2026-05-19
Scope: future Android client direction for PrivoxPTT.

## Why This Is Needed

The current browser/PWA path is useful for testing and quick access, but it is not ideal for always-on radio use.

Main issues:

- phone screen has to stay active;
- battery drains faster when the screen and WebRTC stay active;
- Android/browser background limits can pause socket, audio, or microphone behavior;
- locked-screen operation is limited;
- accidental screen touches are likely;
- hardware PTT buttons on PoC radios may not be available to the browser.

## Recommended Direction

Keep the web/PWA client as the universal fallback, but add Android support later for real field usage.

Do this after the core web system is stable:

1. Stable group PTT.
2. Dispatcher call signals from all groups.
3. Dispatcher call queue and statuses.
4. Basic call logs.
5. Android client MVP.

## Option A: WebView Wrapper

Fastest first Android step.

Possible features:

- package the existing web app inside an Android WebView;
- handle login and saved session more cleanly;
- keep screen awake only when needed;
- add a simple anti-accidental-touch lock mode;
- improve Android permissions flow for microphone/location;
- add native notifications for incoming dispatcher calls or SOS later.

Pros:

- quickest to build;
- reuses existing frontend;
- low risk to server and MediaSoup logic.

Cons:

- background audio/socket behavior may still be limited;
- hardware PTT button support may be weak or device-specific;
- not as reliable as a native radio client.

## Option B: Native Android Client

Better long-term option for real PTT usage.

Expected MVP features:

- login;
- organization/user profile load;
- group list;
- active group selection;
- large PTT button;
- dispatcher call button;
- SOS button;
- location updates;
- foreground service to keep the radio session alive;
- persistent notification: "PrivoxPTT online";
- accidental-touch lock mode;
- microphone and audio routing controls.

Later features:

- hardware PTT button mapping where devices support it;
- headset/Bluetooth button handling;
- lock-screen friendly controls;
- push notifications;
- improved battery modes;
- diagnostics screen for socket, mic, audio, and server health.

Pros:

- can work with screen off or locked using foreground service;
- better battery and lifecycle control;
- better microphone/audio routing;
- better fit for dedicated Android PoC radios;
- possible hardware PTT support.

Cons:

- more engineering work;
- native WebRTC/MediaSoup integration needs careful testing;
- Android permissions and background-service behavior vary by device/vendor.

## Hardware PoC Radio Direction

Before buying or standardizing devices, verify:

- device runs normal Android apps or a modern browser;
- device is not locked to a vendor PTT cloud/server;
- APK installation is allowed;
- microphone, speaker, GPS, network, and Bluetooth work normally;
- hardware PTT button can be mapped to an Android key event or SDK;
- WebRTC audio works reliably over Wi-Fi and LTE.

First test path:

1. Test the current web/PWA on the device.
2. Test a WebView wrapper if browser behavior is close enough.
3. Move to native Android client if background/lock-screen/PTT-button behavior is required.

## Practical Phasing

### Phase 1: Stabilize Web/PWA

- Keep current browser/PWA flow working.
- Improve mobile PTT UX where possible.
- Avoid Android-specific work until dispatcher calls are stable.

### Phase 2: Android WebView MVP

- Build a thin Android shell around the existing web app.
- Add wake-lock and accidental-touch controls.
- Test microphone, speaker, location, Socket.io, and WebRTC.

### Phase 3: Native Android MVP

- Implement native login, group list, active group, PTT, dispatcher call, SOS.
- Add foreground service and persistent notification.
- Reuse existing backend APIs and Socket.io events.

### Phase 4: Field Device Support

- Test dedicated Android PoC radios.
- Add hardware PTT button mapping.
- Tune battery and background behavior.
- Add diagnostics and deployment/update process.

## Not For The Immediate Dispatcher Calls Pass

- Do not start Android work before the dispatcher call queue is proven.
- Do not change server audio architecture just for Android until the web behavior is stable.
- Do not assume hardware PTT support until a real device is tested.

