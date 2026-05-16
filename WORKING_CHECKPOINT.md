# PrivoxPTT Working Checkpoint

Date: 2026-05-16
Status: local PTT audio works in current manual testing.

## What Works Now

- Backend starts locally on `http://127.0.0.1:3000`.
- Web client starts locally on `https://localhost:5173`.
- LAN/mobile web client is available at `https://192.168.1.43:5173`.
- PostgreSQL and Redis are used locally through Homebrew services.
- Socket.io login, presence, group join, PTT lock, and MediaSoup audio path are working.
- Dispatcher desktop transmission works.
- Mobile user PTT press/release was fixed with pointer events and stale-start protection.
- Brave repeated PTT transmission was improved by recreating send transport per transmission.

## Important Fixes In This Checkpoint

- Removed duplicate MediaSoup socket handler registration in `server/src/index.ts`.
- Added a shared socket readiness event in `web/src/hooks/useSocket.ts`.
- Made `useWebRTC` subscribe to producer events after socket readiness.
- Added consumer cleanup on `ms:producer-closed`.
- Added Vite env typings in `web/src/vite-env.d.ts`.
- Changed PTT button from mixed mouse/touch events to pointer events.
- Added forced PTT stop on quick release, tab blur, page hide, and hidden visibility.
- Recreate MediaSoup send transport on every PTT start for better Brave/Safari stability.

## Test Accounts

```text
SUPERADMIN:  admin@privox.tech      / Admin123!
DISPATCHER:  dispatcher@privox.tech / Disp123!
USER:        unit1@privox.tech      / Unit123!
USER:        unit2@privox.tech      / Unit123!
USER:        unit3@privox.tech      / Unit123!
USER:        unit4@privox.tech      / Unit123!
```

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

## Rollback

This checkpoint is saved as a git commit. To return to it later:

```bash
git log --oneline
git checkout <checkpoint_commit_hash>
```

If you want to discard later changes and force the project back to this exact checkpoint:

```bash
git reset --hard <checkpoint_commit_hash>
```

Use the hard reset only when you are sure newer changes can be discarded.

## Known Issues

- `server npm run build` still has pre-existing TypeScript errors in CRUD routes and Prisma logging typings.
- Safari needs extra manual testing for microphone permission and WebRTC behavior.
- PWA/service worker can cache old frontend bundles; use hard refresh or close/reopen the page after frontend changes.
