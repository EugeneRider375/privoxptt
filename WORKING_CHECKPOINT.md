# PrivoxPTT Working Checkpoint

Date: 2026-05-19
Status: production server, API, Socket.io, login, and MediaSoup health are working after Coolify deployment recovery.

Update 2026-05-20: production recovered and verified after a successful deploy of `2929039`.
The app briefly returned `Gateway Timeout` even though the app containers were healthy. No code change
was needed; restarting `coolify-proxy` restored public access.

Update 2026-05-20: visual user-to-user call notification is working in production. The caller taps a
phone icon next to an online group member; the target receives a large centered incoming-call alert.
The regular top-right alert remains as lightweight call history for now.

Update 2026-05-20: user-to-user call sound is working after `d490283`. Android plays the call tone,
but it is still quiet on the tested device. iPhone now plays the call tone and is louder than Android.
This is the current working checkpoint.

## Production State

- Production site: `https://ptt.privox.tech`
- Healthcheck verified again on 2026-05-20 after proxy recovery:

```json
{
  "status": "ok",
  "service": "PrivoxPTT",
  "version": "1.0.0",
  "timestamp": "2026-05-20T08:41:04.778Z",
  "arch": "x64",
  "mediasoup": {
    "workers": 2,
    "ok": true,
    "error": null
  }
}
```

- Frontend is served through nginx/Traefik.
- Backend is reachable through `/api`, `/health`, and `/socket.io`.
- PostgreSQL and Redis containers are healthy in Coolify.
- MediaSoup workers start successfully in Docker with `MESON_ARGS="-Dms_disable_liburing=true"`.
- WebRTC media ports remain `10000-10100` UDP/TCP.
- Current known-good deployed code is `d490283`.

## What Works Now

- Login and role-based routing work in production.
- Admin, dispatcher, and user accounts can use PTT in production.
- Dispatcher visual call queue/call button is present.
- Activity log for user online/offline events is present.
- Visual user-to-user call alerts are present:
  - caller taps the phone icon beside an online member in the active group;
  - recipient sees a centered incoming-call alert;
  - top-right alert remains visible as history;
  - call tone plays; Android is quiet, iPhone is louder in the latest manual test;
  - no auto-switch or "go to group" action yet.
- Dispatcher/admin audio has been manually tested across two browsers.
- Mobile user audio to dispatcher/admin has been manually tested.
- PTT channel locking now waits for server approval before starting WebRTC.
- Group audio is isolated by `groupId`; active group determines what a dispatcher/admin hears.
- Dispatcher map renders with improved readability and no longer defaults to Moscow.
- Dispatcher map auto-centers on active markers, then dispatcher geolocation, then Europe/France fallback.

## Important Fixes In This Checkpoint

- Fixed production server restart loop caused by missing `bcrypt_lib.node`.
- Removed `--ignore-scripts` from production dependency install path.
- Rebuilt native `bcrypt` and `mediasoup` dependencies during Docker build.
- Disabled MediaSoup `liburing` in Docker build to avoid worker exit `code:40` in Coolify/container runtime.
- Added `web/.dockerignore` so local Vite env files are not copied into Docker build context.
- Added server acknowledgement for `ptt-start`.
- Updated client PTT flow to wait for PTT lock approval before creating MediaSoup producer.
- Improved dispatcher map contrast, tile style, and centering behavior.
- Raised contrast for several dispatcher labels and secondary text elements.
- Removed external publication of backend API port `3000`; nginx/web reaches backend through Docker network as `http://server:3000`.
- Removed duplicate `npm rebuild bcrypt mediasoup` from production Docker build; native modules are built during `npm ci --omit=dev`.
- Recovered Coolify deployment after port/network/build issues. If Stop is used, the app network may need to exist before redeploy.
- Recovered a post-deploy `Gateway Timeout` without code changes by restarting only `coolify-proxy`.
  Backend and web were healthy internally:
  - `docker exec server-... node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(console.log).catch(console.error)"`
  - `docker exec web-... wget -qO- http://server:3000/health`
  - `docker exec web-... wget -qO- http://127.0.0.1/health`
  Public access recovered after:
  - `docker restart coolify-proxy`

## Recent Commits

```text
d490283 Increase user call tone reliability
3107549 Fix user call tone audio unlock
076f59b Add user call tone
c351ee1 Record user call checkpoint
9f8fdff Show user calls as centered alert
5f31e6f Add visual user call alerts
5f4fb65 Document production proxy recovery
2929039 Allow dispatchers into organization groups
f640edf Improve presence activity accuracy
3ec2198 Add online activity log
05d328b Restore dispatcher visual calls without audio tone
d8e1007 Revert dispatcher call UI; stable version without dispatcher calls
bced5fe Avoid duplicate native dependency rebuild
d728b37 Avoid publishing backend API port
b824512 Improve dispatcher map readability
86801b2 Disable mediasoup liburing in Docker
e92e24c Fix production server startup and PTT lock handling
```

## Manual Test Notes

Completed:

- Admin and dispatcher PTT audio in two browsers.
- Mobile user PTT audio with dispatcher/admin.
- Production healthcheck with MediaSoup workers healthy.

Still worth testing:

- `USER 1` to `USER 2` in the same group.
- Two different groups active at the same time, confirming no audio/status bleed between groups.
- Second user attempting to talk while first user holds PTT.
- User without `canSpeak` attempting PTT.
- Fast PTT press/release cycles on mobile.
- Closing the mobile browser/PWA while transmitting; channel should release shortly after.
- iPhone Safari microphone permission and playback behavior.
- LTE/Wi-Fi switching during a session.

## Local Run

Start database services if needed:

```bash
brew services start postgresql@16
brew services start redis
```

Start backend:

```bash
cd server
npm run dev
```

Start web:

```bash
cd web
npm run dev
```

Open:

```text
https://localhost:5173
https://192.168.1.43:5173
```

## Deployment

Use exact file paths when adding changes. Do not use `git add .` while local secret files are present.

```bash
git status --short
git add <changed-safe-files>
git commit -m "Describe change"
git push origin main
```

Then in Coolify:

```text
privoxptt -> Redeploy
```

After deploy, verify:

```bash
curl https://ptt.privox.tech/health
```

Expected:

```text
mediasoup.workers = 2
mediasoup.ok = true
```

If public `/health` hangs or returns `Gateway Timeout` after a deploy, do not assume the app is down.
Check in this order:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep x7qkjpjf1vrdn954ibnnghmq
docker exec server-<id> node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(console.log).catch(console.error)"
docker exec web-<id> wget -qO- http://server:3000/health
docker exec web-<id> wget -qO- http://127.0.0.1/health
docker restart coolify-proxy
curl -i https://ptt.privox.tech/health
```

## Known Risks

- PWA/service worker can cache old frontend bundles; use hard refresh or close/reopen installed PWA after deploy.
- `PRODUCTION.md` currently contains production secrets and must not be committed.
- Native mobile apps are not implemented yet; current mobile path is browser/PWA.
- Private one-to-one voice calling is not implemented as a full audio feature; current stable audio model is group PTT.
- Dispatcher/admin currently listen to the active selected group, not all groups at once.
- User-to-user call sound works, but Android call tone volume is still lower than desired on the tested device.
  iPhone requires prior screen interaction/audio unlock, then plays the tone.
- Coolify Stop can remove/recreate app networks and clear Docker build cache. If redeploy fails with missing network, recreate the named network; if build seems slow, check for `meson`/`ninja` compiling MediaSoup.
- Coolify/Traefik proxy can lose the route after deploy while app containers are healthy. Restarting only `coolify-proxy` fixed this on 2026-05-20.

## Future Plans

- Add text messaging later, not during the current production stabilization pass.
- Improve Android call tone audibility later with a longer/repeating loud mode if needed.
- Later add a "go to group" action to the centered user-call alert.
- Later decide whether top-right user-call history should stay or move into a dedicated missed-calls log.
- Start with group chat per channel/group using PostgreSQL history plus Socket.io real-time delivery.
- Consider direct messages, dispatcher private messages, attachments, and a system event timeline in later versions.
- Evaluate open Android PoC radios as dedicated devices; they must not be locked to a vendor server/cloud.
- First test PoC radios through the browser/PWA, then consider a thin native Android wrapper if hardware PTT button support is needed.
- Add server reliability work later: Docker/Coolify healthcheck, unhealthy auto-restart, external `/health` monitoring, and alerts.
- Monitor MediaSoup separately from basic API health because API can be alive while audio is unavailable.
