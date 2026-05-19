# Dispatcher Calls Plan

Date: 2026-05-19
Scope: dispatcher call signals and call logs only. Audio recording is explicitly out of scope for now.

## Implementation Status

- Phase 1 real-time dispatcher call signal: implemented.
- Dispatcher queue UI: implemented as a first version.
- Call accept flow: implemented as a non-persistent Socket.io status update.
- Persistent call logs: not implemented yet.
- Expire/cancel/missed statuses: planned next.

## Current Behavior

- Group PTT audio already works by `groupId`.
- Dispatcher/admin can enter any group in their organization.
- Dispatcher hears and talks only in the currently active selected group.
- Other groups should not be mixed into dispatcher audio automatically.
- SOS alerts already exist as Socket.io events, but normal "call dispatcher" flow is not implemented yet.

## Goal

Allow any group/user to request dispatcher attention without changing the existing PTT audio model.

The dispatcher should receive call signals from different groups, see them in a queue, and choose which group to answer. When the dispatcher accepts a call, the UI switches to that group and the dispatcher hears/talks there through the existing PTT flow.

## Phase 1: Dispatcher Call Signal

Add a lightweight call signal first, without touching MediaSoup/WebRTC audio.

- Add user action: "Call dispatcher" from the active group.
- Add Socket.io event from client to server:

```text
dispatcher-call-request
```

- Server validates:
  - user is authenticated;
  - `groupId` exists;
  - user belongs to the group, unless privileged;
  - group belongs to the same organization.

- Server emits to dispatcher/admin clients in the organization:

```text
dispatcher-call-incoming
```

- Payload should include:
  - `callId`;
  - `groupId`;
  - `groupName`;
  - `fromUserId`;
  - `callsign`;
  - `displayName`;
  - `message`;
  - `priority`;
  - `createdAt`.

## Phase 2: Dispatcher Queue UI

Add an incoming calls panel to the dispatcher dashboard.

- Show pending calls from all groups.
- Sort by priority first, then time.
- Show group name, caller callsign, message, and waiting time.
- Add "Accept" action.
- On accept:
  - switch `activeGroupId` to the call's `groupId`;
  - join/open that group through the existing flow;
  - mark the call as answered.

Important behavior:

- Dispatcher hears only the accepted/active group.
- If calls arrive from multiple groups at the same time, they stay in the queue.
- Calls from non-active groups should not automatically start audio playback.

## Phase 3: Call Statuses

Add call lifecycle handling.

Recommended statuses:

```text
pending
answered
cancelled
missed
expired
```

Rules:

- First dispatcher to accept marks the call as `answered`.
- Other dispatchers should see the updated status.
- User can cancel a pending call.
- Pending calls should expire automatically after a configurable timeout, for example 60-120 seconds.
- SOS remains higher priority than normal dispatcher calls.

## Phase 4: Call Logs

Add persistent logging in PostgreSQL after the real-time flow works.

Suggested table: `RadioCallLog` or `CallEvent`.

Useful fields:

```text
id
organizationId
groupId
fromUserId
dispatcherId
type              dispatcher_call | sos | private_call_later
status            pending | answered | cancelled | missed | expired
priority          normal | urgent | sos
message
createdAt
answeredAt
endedAt
metadata
```

Admin/dispatcher history should answer:

- who called;
- from which group;
- when they called;
- who accepted;
- how long it took to answer;
- whether it was missed or expired.

## Phase 5: Notification Polish

Add after the basic workflow is stable.

- Visual blinking call card for pending calls.
- Sound notification for dispatcher calls.
- Stronger/repeating sound for SOS.
- Setting to enable/disable sound and adjust volume.
- Browser audio unlock handling after dispatcher first interacts with the page.

## Not In This Pass

- Audio recording.
- Listening to multiple groups at the same time.
- Full private one-to-one audio calls.
- Android native app work.
- Large database/event-history refactor before the real-time call queue is proven.

## Safety Notes

- Keep existing PTT flow unchanged in phase 1.
- Do not modify MediaSoup behavior for dispatcher call signals.
- Use the existing organization socket room for dispatcher notifications.
- Add server validation before broadcasting any call event.
- Test with two groups calling at once and one dispatcher accepting only one of them.
