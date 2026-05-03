# Copilot Backlog For The Atman Observation Milestone

## Purpose

This file turns the observation brief into an implementation backlog tied to concrete files, endpoints, validation steps, and rollout order.

The milestone is complete only when Atman can safely observe, summarize, ask clarifying questions, and report learning without default raw-data retention.

## Phase 0. Safety And Interface Contracts

### Target files

- `server/agent-runtime.mjs`
- `server/dialog/atman.mjs`
- `server/dialog/atman-personality-manager.mjs`
- `static/admin.html`
- `src/components/AgentConsole.tsx` or the closest operator-facing panel

### Required outcomes

1. define observation status shape;
2. define learning report shape;
3. define clarification question shape;
4. define consent state shape;
5. reserve event names for observation lifecycle.

### Suggested endpoints

- `GET /api/atman/observe/status`
- `POST /api/atman/observe/control`
- `GET /api/atman/observe/report`
- `GET /api/atman/observe/data`

### Validation

- confirm observation is off by default;
- confirm the status endpoint exposes only consent and capability metadata before activation.

## Phase 1. Observation Base Layer

### New files

- `server/observation/activity-collector.mjs`
- `server/observation/user-context-queue.mjs`
- `server/observation/observation-policy.mjs`

### Required outcomes

1. collect active-window metadata;
2. collect coarse typing metrics only;
3. bound retention in memory;
4. label every observation envelope with privacy metadata;
5. expose a redacted snapshot for admin inspection.

### Runtime integration

- wire the policy and queue into `server/agent-runtime.mjs`;
- extend Atman with `observe()` and `getObservationStatus()`;
- emit redacted events to `/api/atman/events`.

### Validation

- start observation with `!observe on`;
- verify only minimal scopes are active;
- stop observation with `!observe off` and verify in-memory buffers are cleared.

## Phase 2. Interpretation Layer

### New files

- `server/analysis/intent-inference.mjs`
- `server/analysis/anomaly-detector.mjs`
- `server/analysis/learning-report-gen.mjs`

### Required outcomes

1. infer probable operator activity from the recent observation window;
2. detect anomalies such as rapid context switching or repeated retries;
3. generate a structured learning report;
4. generate a clarification question when confidence is low.

### Runtime integration

- extend Atman with `reportLearning()` and `askClarification()`;
- record aggregate outputs in the learning ledger;
- show the latest report and pending questions in the admin UI.

### Validation

- simulate a short debug workflow;
- run `!report now`;
- verify the output includes patterns learned, uncertainty, and a question when ambiguity remains.

## Phase 3. Multimodal Adapters

### New files

- `server/observation/audio-listener.mjs`
- `server/observation/screen-observer.mjs`
- `server/analysis/multimodal-fusion.mjs`

### Required outcomes

1. add explicit consent gates for audio and screen scopes;
2. downsample and redact media before interpretation;
3. fuse text, audio, and visual hints into one confidence-scored summary;
4. degrade cleanly when any modality is unavailable.

### Runtime integration

- route media capability state through the observation status endpoint;
- expose active sensors and last consent change in the admin UI;
- keep raw media artifacts out of the default learning ledger path.

### Validation

- verify audio and screen scopes require separate consent;
- verify disabled modalities do not break reports or Ultra;
- verify the admin UI shows active sensors and an emergency stop.

## Phase 4. Ultra And Operator Integration

### Target files

- `server/agent-runtime.mjs`
- `server/dialog/atman-personality-manager.mjs`
- `static/admin.html`
- relevant React operator panels in `src/components/`

### Required outcomes

1. allow Ultra to consume observation summaries as optional evidence;
2. keep observation fully optional for standard chat and Ultra flows;
3. expose learning reports and question history to operators;
4. provide an export path for user-approved summaries only.

### Validation

- run Ultra with no observation enabled;
- run Ultra with observation summaries enabled;
- confirm both modes remain stable and safe.

## Phase 5. Documentation And Release Gate

### Files to update together

- `README.md`
- `docs/copilot-atman-observation-instructions.md`
- `docs/copilot-test-scenarios.md`
- `docs/pantheon.md`
- `docs/lastchanges.md`

### Required outcomes

1. document consent behavior and local-only defaults;
2. document what is retained and what is not;
3. document operator commands and admin controls;
4. document that generation work stays blocked until observation reporting is stable.

## Minimum Test Command Set Per Phase

- `npm run beta:test`
- `npm run beta:admin`
- `npm run beta:scenarios`
- `npm run beta:chaos`
- `npm run check`

## Exit Criteria

Do not begin multimodal generation work until all of the following are true:

1. observation is off by default and reversible;
2. reports and questions are meaningful on bounded local evidence;
3. privacy filters are exercised by tests;
4. learning ledger stores summaries only;
5. Ultra and admin flows remain stable under disabled and degraded observation states.
