# WebRTC receive after redeploy

Date: 2026-05-29

## Symptom

After a Coolify redeploy/server restart, web clients, Android WebView clients, and dispatchers could still transmit with PTT, but they stopped receiving incoming audio.

Logout/login fixed the issue immediately.

The ESP32 mini radio continued to work, which showed that the server audio path itself was not fully broken.

## Cause

The browser Socket.io client reconnects automatically after the server restarts, but the server-side Socket.io rooms and mediasoup WebRTC transports are tied to the old socket session.

Transmit kept working because PTT creates a fresh send transport when the user presses the button.

Receive broke because it is passive:

- the client must be in the active Socket.io group room,
- the client must listen for `ms:new-producer`,
- the client must have a fresh recv transport/consumer graph.

After redeploy, the active group did not always get rejoined and the receive transport was not always rebuilt in the right order.

## Fix

Implemented in:

- `web/src/hooks/useSocket.ts`
- `web/src/hooks/useWebRTC.ts`
- `web/src/pages/user/UserRadioPage.tsx`
- `web/src/pages/dispatcher/DispatcherDashboard.tsx`

Commits:

- `b20f04a Fix WebRTC receive after socket reconnect`
- `f6709de Rejoin active PTT group on socket recovery`

Current behavior:

1. On Socket.io `connect`, the client republishes the socket-ready event.
2. The active radio screen re-sends `join-group` for the current active group.
3. `useWebRTC` detects the recovered socket session.
4. Existing consumers and recv transport are closed.
5. Pending recv transport creation is cleared.
6. After a short delay, the client creates a fresh recv transport and gets current producers again.

This keeps the fix client-side and does not change the server protocol, mediasoup server code, UDP bridge, or ESP32 mini radio behavior.

## Verification

Test that passed:

1. Open two clients on the radio screen.
2. Confirm PTT transmit/receive works before redeploy.
3. Redeploy/restart the project in Coolify.
4. Do not logout/login.
5. Wait for clients to reconnect.
6. Press PTT from client A.
7. Confirm client B receives audio.
8. Test the reverse direction.

Important: because the web app uses PWA/service worker caching, after deploying this fix once, hard refresh the browser or fully close/reopen the Android app so the new JS bundle is loaded.

## Future improvement

For around 100 active clients this is fine.

Before scaling to thousands of simultaneously connected clients, add jitter to socket recovery so all clients do not recreate receive transports at the same time after a server restart. Example: wait a random 0-3000 ms before rejoining/rebuilding receive transport.
