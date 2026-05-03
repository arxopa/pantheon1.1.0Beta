# Social Guide

## Scope

This guide documents the currently implemented Social Phase 3 and Phase 4 runtime.
It now covers the personality-to-personality talk protocol, shared context memory, social rooms, direct `!room` commands, relationship state, coalitions and conflicts, admin live monitoring, structured emotion state, audit visibility, and current limitations.

## What exists now

Pantheon already had social simulation primitives in `AtmanPersonalityManager`.
The new Social Phase 3 foundation turns that into an operator-visible runtime contract instead of leaving it as an internal-only simulation surface.

Implemented runtime surface:

- `POST /api/personality/talk`
- `GET /api/personality/shared-context`
- `POST /api/personality/shared-context`
- `GET /api/personality/rooms`
- `GET /api/personality/rooms/{roomId}`
- `POST /api/personality/rooms/create`
- `POST /api/personality/rooms/join`
- `POST /api/personality/rooms/leave`
- `POST /api/personality/rooms/delete`
- `POST /api/personality/rooms/message`
- `GET /api/personality/relationships`
- `POST /api/personality/relationships`
- `POST /api/personality/rooms/coalition/create`
- `POST /api/personality/rooms/coalition/join`
- `POST /api/personality/rooms/coalition/leave`
- `POST /api/personality/rooms/coalition/delete`
- `POST /api/personality/rooms/coalition/{coalitionId}/add`
- `POST /api/personality/rooms/coalition/{coalitionId}/remove`
- `POST /api/personality/rooms/coalition/{coalitionId}/delete`
- `POST /api/personality/rooms/conflict/declare`
- `POST /api/personality/rooms/conflict/resolve`
- `POST /api/personality/rooms/conflict/{conflictId}/resolve`
- `GET /ws/social/room/{roomId}`
- `GET /api/admin/audit-log?type=social`

This new social layer works alongside the older exploratory endpoints:

- `GET /api/atman/social-map`
- `POST /api/atman/social-simulate`

## Personality talk protocol

`POST /api/personality/talk` sends an internal social message from one personality to another or to a bounded small group.

Current request shape:

- `sourcePersonalityId`
- `targetPersonalityId` or `targetPersonalityIds`
- optional `channelId`
- optional `topic`
- `message`
- optional `facts`

Current behavior:

- delivery is serialized through an internal queue;
- each target reply is generated through that target personality's existing Atman runtime;
- the shared context channel is updated before and after delivery;
- the talk path reuses the existing social-evolution logic in `AtmanPersonalityManager` so relationship state and emotion change together;
- a bounded per-pair rate limit prevents trivial message loops.

## Shared context

Shared social memory now lives in `server/social/shared-context.mjs`.

Each channel keeps:

- `id`
- `topic`
- `members`
- `facts`
- `recentMessages`
- `coalitions`
- `conflicts`
- `metadata`

This is a bounded, file-backed store intended for operator-visible and beta-testable group context.
It is not yet a distributed memory layer and not yet a vector store.

## Social rooms

Social rooms now live in `server/social/social-room.mjs`.

Current room behavior:

- a room is a thin wrapper over one shared-context channel;
- room state persists `id`, `name`, `channelId`, `members`, `topic`, and lightweight metadata;
- operator and chat flows can create a room, add a personality to it, remove a personality, archive the room, and send room-scoped messages;
- active room selection is tracked per `userId + personalityId`, so the direct `!room` commands can work without requiring the room id in every turn.

Current room commands in direct Atman chat:

- `!room create "Name" --personalities=architect,analyst`
- `!room list`
- `!room send "text" --to=architect`
- `!room coalition create "Alliance"`
- `!room coalition join alliance-id`
- `!room coalition leave alliance-id`
- `!room conflict declare analyst --reason="agenda drift"`
- `!room conflict resolve conflict-id`
- `!room leave`
- `!relation show architect`

Current operator flow:

- the admin panel now includes a `Социальные комнаты` card;
- operators can create a room, select it, join with the currently selected personality, send a message, and inspect the updated transcript;
- the admin card can also open a live room stream through `/ws/social/room/{roomId}`.

## Relationships, coalitions, and conflicts

Relationship state now lives in `server/social/relationship-matrix.mjs`.

Each directed relation keeps:

- `sourcePersonalityId`
- `targetPersonalityId`
- `trust`
- `affection`
- `dominance`
- `notes`
- `lastUpdatedAt`

Current relationship behavior:

- direct social exchange updates trust, affection, and dominance after successful delivery;
- Atman prompt construction now receives relationship context for the current counterpart;
- Ultra synthesis receives expert relation metadata so tension and alignment can influence the final answer.

Current coalition and conflict behavior:

- implicit room broadcast is filtered to coalition peers when the sender belongs to a coalition;
- direct delivery is blocked when an active conflict exists between sender and target;
- coalition and conflict state persists with the room channel and is visible to operators and tests.

## Admin UI for coalitions and conflicts

The admin panel now includes a dedicated `Коалиции и конфликты` card.

Current operator actions:

- select any existing social room;
- create a coalition with a chosen room member as leader;
- add or remove coalition participants and delete a coalition entirely;
- declare a conflict between room participants and resolve it;
- inspect a lightweight trust matrix for the selected room.

The panel reuses the existing bearer-token protected admin request path and refreshes the room governance snapshot after every mutation.

## Live monitoring

Room live monitoring uses a websocket endpoint:

- `GET /ws/social/room/{roomId}`

Current websocket behavior:

- the initial connection publishes a `room-connected` snapshot;
- room lifecycle changes publish events such as `room-created`, `room-updated`, `room-left`, and `room-message`;
- each event includes the current room snapshot and the current bounded transcript, so admin observers can repaint from one event without extra round-trips.

## Emotion model

Each personality now has explicit structured emotion state:

- `emotion.type`
- `emotion.intensity`
- `emotion.volatility`
- `emotion.updatedAt`

This state is normalized in `server/dialog/atman-personality-manager.mjs`.

Current emotion behavior:

- social exchange updates both `dynamicState.lastEmotion` and the richer `emotion` object;
- positive exchanges currently bias personalities toward states like `bonding` and `engaged`;
- tense exchanges bias them toward states like `guarded` and `irritated`;
- Atman prompt construction now includes the current emotion, so stub and prompt-based replies can reflect the updated social state.

## Ledger and audit visibility

Social activity is now persisted in two places:

- `learningLedger.socialExchanges`
- `learningLedger.sharedContextEvents`

Operator audit also records social activity.
Current social audit kinds include:

- `social-context-updated`
- `social-talk`
- `social-room-created`
- `social-room-joined`
- `social-room-left`
- `social-room-deleted`
- `social-room-message`
- `social-room-coalition-created`
- `social-room-coalition-joined`
- `social-room-coalition-left`
- `social-room-coalition-deleted`
- `social-room-conflict-declared`
- `social-room-conflict-resolved`
- `social-relationship-updated`
- `social-room-ws-opened`

These are visible through `/api/admin/audit-log?type=social`.

## Validation coverage

The beta suite now includes dedicated Social Phase 3 and Phase 4 coverage that verifies:

- shared context creation;
- personality talk delivery;
- transcript persistence;
- structured emotion updates;
- social audit visibility;
- OpenAPI presence for the new social endpoints.

It now also verifies:

- room creation and room-scoped message delivery;
- direct `!room` command behavior through `/api/atman/chat`;
- websocket live monitoring for room transcript updates;
- admin UI room creation and live transcript viewing;
- relationship matrix persistence and `!relation show`;
- coalition-aware routing and conflict blocking;
- Ultra expert relation synthesis;
- admin UI coalition and conflict lifecycle management;
- a load-test mode that spreads social traffic across multiple rooms.

## Current limitations

The following are not implemented yet:

- long-term vectorized shared memory;
- operator-controlled permission matrix for per-fact read/write rights.
- richer operator analytics over coalition evolution across many rooms;
- cross-room or global social governance policies.

## Next likely steps

- define explicit permission controls for reading and mutating shared context;
- decide whether social channels need persistence beyond the current local JSON store;
- expand operator analytics from the current per-room trust matrix to longer-range social trend views.
