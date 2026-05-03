# Copilot Instructions: Social Phase 3 Rooms And Live Monitoring

## Goal

Social Phase 3 foundation is complete and approved.
The next step is to finish the current social milestone by adding room management and live dialogue monitoring without replacing the already working shared-context and personality-talk foundation.

This stage should complete the operator-visible social runtime, not redesign it from scratch.

## What must stay true

1. Keep `server/social/shared-context.mjs` as the base persistence layer for room context.
2. Keep `server/social/social-channel.mjs` as the bounded delivery path for personality-to-personality messaging.
3. Do not fork a second unrelated social subsystem.
4. Preserve the current rate-limited and queue-serialized delivery behavior.
5. Preserve learning-ledger recording and operator audit visibility for social activity.
6. Preserve the current Social Phase 3 foundation endpoints while extending them.

## Primary implementation targets

### 1. Room management

Add a dedicated room orchestration layer in a new file:

- `server/social/social-room.mjs`

Required capabilities:

- create and delete rooms;
- add and remove personalities from rooms;
- map each room to a shared-context channel;
- expose room metadata cleanly enough for admin inspection.

Required outcome:

- a room is a first-class bounded social container, not only an implicit channel id.

### 2. Dialogue commands for rooms

Add a user-facing control surface for room flows.

Required commands:

- `!room create <name> --personalities=...`
- `!room list`
- `!room send <roomId> <sourcePersonalityId> <message>`

If a slightly different command grammar is chosen, keep it simple, deterministic, and document it.

Required outcome:

- a user or operator can create a room and send a social message inside it without manually constructing raw API payloads.

### 3. HTTP API for rooms

Extend the runtime so room management is not chat-only.

Expected additions:

- room create/list/get/update endpoints under a stable `/api/personality/rooms` or `/api/social/rooms` surface;
- room send endpoint, or reuse of `POST /api/personality/talk` with explicit room binding;
- admin-protected access where appropriate.

Required outcome:

- the admin plane and manual testers can manage rooms via HTTP in a predictable way.

### 4. WebSocket live monitoring

Add a live monitoring path for room dialogue.

Required endpoint:

- `/ws/social/room/<roomId>`

Expected behavior:

- broadcast social events and new messages for the room;
- include enough event metadata for admin rendering;
- do not leak unrelated room traffic;
- keep the implementation bounded and local, not broker-dependent.

Required outcome:

- an operator can watch live room dialogue as it happens.

### 5. Admin panel integration

Extend the admin plane with a new room-oriented surface.

Required UI scope:

- a `Social Rooms` section or tab;
- room list and current room metadata;
- live transcript view fed by the WebSocket stream;
- a clear state for connected, disconnected, and empty-room conditions.

Required outcome:

- room creation and live observation are both inspectable from admin without manual curl-only workflows.

### 6. Load and concurrency validation

The social layer now needs explicit load coverage.

Required work:

- extend `beta:load` with social traffic scenarios;
- simulate at least 50 concurrent social exchanges across about 10 personalities;
- capture `p95` latency for `POST /api/personality/talk`;
- verify that rate limiting still behaves correctly under load and does not collapse into race conditions.

Required outcome:

- social traffic is performance-checked, not only functionally checked.

### 7. Documentation expansion

After rooms and WebSocket monitoring are implemented, update:

- `docs/social-guide.md`
- `README.md`

Also add:

- `docs/social-api-examples.http` or `docs/social-api-examples.rest`

Required outcome:

- room and live-monitoring workflows are documented with usable examples.

## Validation requirements

After substantive implementation work for this stage:

1. run `npm --prefix /Users/ogr/Dots2 run beta:test`;
2. run `npm --prefix /Users/ogr/Dots2 run beta:admin` because admin live-room UI changes are in scope;
3. run `npm --prefix /Users/ogr/Dots2 run beta:load` because social throughput and latency are now explicit requirements;
4. run `npm --prefix /Users/ogr/Dots2 run check` before approval.

## Definition of done for this stage

This step can be considered complete when all of the following are true:

1. rooms can be created and listed;
2. personalities can send messages inside a room;
3. room traffic is tied to shared context cleanly;
4. live room dialogue can be watched through `/ws/social/room/<roomId>`;
5. admin has a visible room-monitoring surface;
6. social load behavior is measured and acceptable;
7. docs are updated;
8. validation remains green.

## Reporting requirement for the next report

After completion, add the following entry to `docs/lastchanges.md`:

```md
### 27. Social Phase 3 – Rooms and live WebSocket monitoring

- [x] Реализованы комнаты (`!room create/list/send`, API управления).
- [x] Добавлен WebSocket `/ws/social/room/<roomId>` для live-просмотра диалогов.
- [x] Обновлена админ-панель: вкладка «Социальные комнаты`.
- [x] Расширены тесты (`beta:test`, `beta:admin`).
- [x] Обновлена документация.
```

## Reporting principle for the next DeepSeek report

The next DeepSeek-facing report should not be only a file inventory.
It should be stage-oriented and answer these questions first:

1. What functional milestone was completed.
2. What user-visible/operator-visible behaviors now exist.
3. What was intentionally left out.
4. What validation was run and what the final result was.
5. Which files are the primary review targets.

File-by-file detail can still exist, but only after the stage-level summary and outcome are clear.
