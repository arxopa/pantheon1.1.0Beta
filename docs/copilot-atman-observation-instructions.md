# Copilot Instructions For Expanding Atman Into A Real-Time Observer

## Purpose

This document tells Copilot how to extend Atman from a dialogue engine into a local, explicitly consented observation-and-learning assistant.

The target behavior is not content generation yet.
The first milestone is safe observation, multimodal interpretation, learning reports, and clarification questions.
Only after that foundation is stable should Pantheon attempt multimodal generation or imitation workflows.

## Product Goal

Atman should be able to:

1. observe the local operator workflow in real time with explicit opt-in;
2. analyze text, audio, and video context without default raw-data retention;
3. infer what the operator is probably trying to do;
4. report what it learned, what remains uncertain, and what it wants clarified;
5. ask short questions when the observed behavior is ambiguous;
6. feed only aggregated insights into the existing event, learning, and admin surfaces.

## Hard Boundaries

Copilot must preserve these constraints while designing and implementing the feature:

1. observation is local-only by default;
2. observation is off by default;
3. every sensor class needs explicit user consent;
4. raw keystrokes are forbidden by default;
5. password-like, payment-like, and secret-like content must never be retained;
6. raw audio and raw screenshots must be treated as temporary in-memory buffers unless the user explicitly exports them;
7. learning reports may persist summaries, but not raw surveillance artifacts;
8. Atman may ask for clarification, but must not silently escalate collection scope.

## Repository Placement

Copilot should add the new capability as separate backend modules instead of overloading the current Atman core file.

Recommended structure:

```text
server/
  observation/
    activity-collector.mjs
    audio-listener.mjs
    screen-observer.mjs
    user-context-queue.mjs
    observation-policy.mjs
  analysis/
    intent-inference.mjs
    anomaly-detector.mjs
    multimodal-fusion.mjs
    learning-report-gen.mjs
  dialog/
    atman.mjs
    atman-personality-manager.mjs
```

## Platform And Permission Notes

Copilot must design the observation milestone around real local-platform constraints instead of assuming full unrestricted capture.

On macOS in particular:

1. window observation and screen capture depend on OS privacy permissions;
2. microphone capture depends on explicit device permission;
3. browser `getUserMedia()` can help for web-mediated audio or video flows, but it is not a full substitute for local desktop observation;
4. some input-monitoring libraries require elevated permissions and may be too invasive for the default scope.

That means the first implementation should prefer:

- active window metadata;
- coarse typing and activity metrics;
- explicit browser-mediated media capture where possible;
- local stubs or adapters for screen and audio analysis.

Copilot should keep every sensor behind a capability check and return a clear disabled-state report when the platform or permission model blocks collection.

## Suggested Dependency Direction

Copilot may use existing ecosystem tools where they fit, but must wrap them behind narrow adapters.

Reasonable candidates for exploration:

- `active-win` for active window metadata;
- a bounded input-metrics adapter instead of unrestricted keylogging;
- `screenshot-desktop` or an equivalent adapter for low-rate screen frames;
- browser `getUserMedia()` for admin-initiated audio and video permission flows;
- a local transcription or intent adapter, ideally stub-first and Ollama-compatible second.

Copilot should not hardwire the whole feature to one capture library.
Each adapter should degrade cleanly when unavailable.

## Required Runtime Model

Copilot should design the feature as a pipeline with five stages.

### 1. Collection

Collect only minimal local signals at first:

- active application name;
- active window title;
- coarse typing metrics such as burst length, idle time, and correction rate;
- clipboard-change metadata without content by default;
- low-rate screenshot frames or screen regions only after explicit screen consent;
- microphone voice-activity windows and optional transcripts only after explicit audio consent.

### 2. Normalization

Convert raw sensor signals into a unified observation envelope:

```json
{
  "kind": "window-focus",
  "source": "activity-collector",
  "timestamp": "2026-05-02T09:00:00.000Z",
  "sessionId": "observe-...",
  "privacy": {
    "rawRetained": false,
    "contentIncluded": false,
    "consentScope": "windows"
  },
  "payload": {
    "app": "Code",
    "title": "agent-runtime.mjs",
    "durationMs": 4200
  }
}
```

### 3. Interpretation

Run lightweight interpretation layers that infer probable activity without claiming certainty:

- `intent-inference.mjs`: probable current task such as coding, reading docs, reviewing logs, editing media, or comparing outputs;
- `anomaly-detector.mjs`: identifies deviations from the operator's recent baseline;
- `multimodal-fusion.mjs`: correlates text, audio, and visual signals into one confidence-scored hypothesis.

Text, audio, and video should not be treated as symmetric sources.

- text context should prefer redacted summaries and editor/window metadata before raw content;
- audio context should prefer voice activity and short transcription windows before permanent transcript storage;
- video context should prefer low-resolution frame classification before storing any image artifacts.

### 4. Dialogue-facing insight generation

Atman should not ingest the full raw stream.
It should receive compact insight objects such as:

```json
{
  "kind": "operator-intent-hypothesis",
  "confidence": 0.81,
  "summary": "The operator is likely debugging runtime behavior across VS Code, browser admin, and beta reports.",
  "evidence": [
    "Frequent focus switches between Code and admin.html",
    "Recent terminal check and beta commands",
    "Repeated reads of runtime and report files"
  ],
  "uncertainty": [
    "Screen evidence was unavailable",
    "Audio observation is disabled"
  ]
}
```

### 5. Reporting and questioning

Atman should convert insights into:

- periodic learning reports;
- event-stream items;
- admin-panel summaries;
- short clarification questions.

## Recommended Module Responsibilities

### `server/observation/activity-collector.mjs`

Responsibilities:

- active-window polling;
- coarse input metrics;
- app-switch frequency;
- session-level focus timeline.

Must not do:

- raw keylogging by default;
- content capture from password-like contexts.

### `server/observation/audio-listener.mjs`

Responsibilities:

- start and stop microphone capture under explicit consent;
- perform voice activity detection;
- optionally send short windows to a local transcription adapter;
- classify transcripts into intent hints, not permanent raw archives.

### `server/observation/screen-observer.mjs`

Responsibilities:

- capture low-frequency screenshots only with consent;
- downsample frames before analysis;
- extract coarse context such as editor, browser, terminal, chart, meeting, or media tool.

### `server/observation/user-context-queue.mjs`

Responsibilities:

- short in-memory queue for the last observation window;
- bounded retention;
- per-source TTL cleanup;
- privacy labels on each event.

### `server/observation/observation-policy.mjs`

Responsibilities:

- consent state;
- blocked contexts;
- sensor enablement rules;
- redaction policy;
- export policy.

### `server/analysis/intent-inference.mjs`

Responsibilities:

- infer probable operator intent from the current observation window;
- return a confidence score and alternatives;
- support a local-model adapter and a stub fallback.

### `server/analysis/anomaly-detector.mjs`

Responsibilities:

- compare the current session against recent local baselines;
- detect abrupt workflow changes, confusion loops, or repeated retries;
- emit compact anomaly objects for Atman and the admin view.

### `server/analysis/multimodal-fusion.mjs`

Responsibilities:

- join text, audio, and visual hints into one timeline;
- degrade gracefully when some modalities are disabled;
- surface uncertainty explicitly.

### `server/analysis/learning-report-gen.mjs`

Responsibilities:

- summarize what Atman learned during the observation window;
- generate operator-readable reports;
- recommend what question to ask next when confidence is low.

## Atman Changes

Copilot should extend Atman through narrow, explicit methods rather than hidden side effects.

Recommended additions:

- `observe(observationEnvelope)`
- `reportLearning(options)`
- `askClarification(questionPayload)`
- `getObservationStatus()`
- `clearObservationBuffer()`

Expected behavior:

1. `observe()` accepts only normalized observation envelopes;
2. `reportLearning()` produces a user-facing learning summary and an operator-facing structured report;
3. `askClarification()` produces short, specific questions tied to uncertainty, not generic chatter;
4. `getObservationStatus()` explains which sensors are active and what data classes are currently allowed;
5. `clearObservationBuffer()` drops in-memory observation windows immediately.

## Required User Commands

Copilot should add explicit operator commands before enabling any automated observation workflow.

- `!observe status`
- `!observe on`
- `!observe off`
- `!observe audio on`
- `!observe audio off`
- `!observe screen on`
- `!observe screen off`
- `!observe keystrokes on`
- `!observe keystrokes off`
- `!observe data`
- `!report now`

Command rules:

1. `!observe on` enables only the minimal safe scope first;
2. audio, screen, and expanded keystroke scopes require separate consent steps;
3. `!observe data` returns a redacted summary of currently held observation data;
4. `!report now` forces a fresh learning report from the current insight buffer.

## Consent And Safety UX

Before the first observation session, Atman must state clearly:

- what it will observe;
- what it will not store;
- how to turn it off;
- what requires extra approval;
- whether any modality is disabled.

Minimum consent text behavior:

1. windows and coarse activity metrics may be enabled first;
2. raw content capture must remain off unless the user explicitly expands the scope;
3. microphone and screen observation must show persistent visible indicators in the UI;
4. admin surfaces must show live sensor status and last consent change.

## Integration Points With Existing Pantheon Surfaces

### Event stream

Observation must integrate with `/api/atman/events`, but only through redacted event types such as:

- `observation-session-started`
- `observation-session-stopped`
- `observation-intent-updated`
- `observation-anomaly-detected`
- `observation-clarification-requested`
- `observation-learning-report-generated`

### Learning ledger

The learning ledger should persist only aggregated outputs:

- reports;
- anomaly summaries;
- clarification questions;
- consent changes;
- accepted operator corrections.

The ledger must not persist raw screenshots, raw audio, or raw keystroke streams by default.

### Ultra mode

Ultra should be able to consume observation summaries as optional evidence, not as mandatory input.

Examples:

- the analyst expert can use a summary that the operator is comparing logs and CSV files;
- the architect expert can use a summary that the operator is editing UI structure and browser layout;
- Ultra should still work when all observation modules are disabled.

### Admin plane

The admin UI should gain:

- observation status panel;
- active consent scopes;
- recent redacted observation events;
- latest learning report preview;
- pending clarification question queue;
- emergency stop control for all sensors.

## Reporting Contract

Copilot should standardize a structured report shape before building any UX around it.

Suggested shape:

```json
{
  "kind": "atman-learning-report",
  "createdAt": "2026-05-02T09:00:00.000Z",
  "sessionId": "observe-...",
  "activeScopes": ["windows", "typing-metrics"],
  "intentSummary": {
    "primary": "debugging runtime behavior",
    "confidence": 0.81,
    "alternatives": ["reviewing docs", "comparing browser output"]
  },
  "patternsLearned": [
    "The operator often alternates between runtime code and admin validation.",
    "The operator tends to verify changes immediately with focused test commands."
  ],
  "uncertainties": ["The reason for repeated browser revisits is unclear."],
  "questions": [
    "Are you comparing UI output against runtime traces, or checking operator flows manually?"
  ],
  "retention": {
    "rawArtifactsStored": false,
    "aggregatesPersisted": true
  }
}
```

## Clarification Payload Contract

Copilot should also standardize the question object that Atman emits when it needs operator guidance.

Suggested shape:

```json
{
  "kind": "atman-clarification-question",
  "createdAt": "2026-05-02T09:00:00.000Z",
  "sessionId": "observe-...",
  "priority": "normal",
  "question": "Are you comparing browser output against runtime traces, or just checking the UI result?",
  "reason": "Repeated alternating focus between VS Code and the admin page produced two competing intent hypotheses.",
  "confidence": 0.56,
  "actions": ["Compare UI and logs", "Only checking UI", "Something else"]
}
```

Questions should be short enough to surface in the admin UI, the main chat flow, or a lightweight notification channel.

## Clarification Question Rules

Questions should be emitted only when they are actionable.

Good questions:

- clarify an ambiguous workflow switch;
- ask whether a repeated action means confusion or deliberate comparison;
- ask whether the operator wants Atman to learn a specific workflow.

Bad questions:

- generic conversation filler;
- requests for secrets or credentials;
- broad questions detached from current evidence;
- repeated questions when confidence is already high.

## Multimodal Roadmap Order

Copilot should implement the feature in this order.

### Phase 1. Safe local observation base

- consent state;
- activity collector;
- observation queue;
- event integration;
- `!observe` and `!report now` commands.

### Phase 2. Interpretation and reporting

- intent inference;
- anomaly detector;
- learning report generation;
- clarification questions;
- admin visibility.

### Phase 3. Audio and screen understanding

- audio consent flow;
- screen consent flow;
- multimodal fusion;
- redacted observation reports.

### Phase 4. Generation preparation only

- review whether observation quality is high enough;
- validate privacy and retention paths;
- confirm reports and clarification loops work;
- only then plan generation or imitation tasks.

## Required Tests Before Any Future Generation Work

Copilot should not move to multimodal generation until these scenarios exist and pass.

1. observation stays off by default after runtime start;
2. `!observe on` enables only minimal scopes;
3. `!observe off` clears active observation state;
4. screen and audio scopes require explicit separate consent;
5. blocked contexts redact secrets and sensitive fields;
6. learning reports contain patterns, uncertainty, and questions;
7. clarification questions are emitted only when confidence is low;
8. event stream shows redacted observation events;
9. learning ledger persists summaries but not raw artifacts;
10. Ultra remains functional when observation is disabled or degraded.

## Required Documentation Follow-Up

Copilot should treat the observation milestone as incomplete until these docs are updated together:

1. `README.md` with operator-facing capability and privacy notes;
2. `docs/copilot-test-scenarios.md` with the exact regression coverage for observation;
3. `docs/pantheon.md` with the new backend surfaces;
4. `docs/lastchanges.md` with the latest DeepSeek-facing summary;
5. admin-facing copy describing active sensors, consent state, and emergency stop behavior.

## Copilot Implementation Notes

1. Prefer local model adapters or deterministic stubs first.
2. Keep every new module independently testable.
3. Reuse the existing event and ledger patterns instead of inventing parallel persistence systems.
4. Keep the observation path bounded and reversible.
5. Treat uncertainty as first-class output, not as hidden failure.
6. Do not start generation work until observation, reports, and clarification loops are stable.
