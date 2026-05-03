# Copilot Test Scenarios

## Purpose

These scenarios are the minimum regression set Copilot should use when validating Pantheon changes before approval.

## Core Runtime Scenarios

### 1. Admin auth guard

- configure `PANTHEON_ADMIN_USERNAME`, `PANTHEON_ADMIN_PASSWORD`, and `PANTHEON_ADMIN_API_TOKEN`;
- confirm `/admin` or `/admin.html` returns `401` without valid Basic Auth;
- confirm protected admin APIs return `401` without a Bearer token;
- confirm the same APIs return `200` with a valid Bearer token.

### 2. Ultra session continuity

- start a conversation with `!ultra`;
- verify expert routing selects domain-relevant personalities;
- verify a follow-up turn keeps the same Ultra session id;
- verify `!normal` exits Ultra mode cleanly.

### 3. Ultra degraded fallback

- simulate expert failure or timeout;
- verify `/api/atman/chat` still returns `200`;
- verify `report.ultra.degraded === true`;
- verify `report.ultra.failures` is populated;
- verify the response is a safe degraded fallback instead of a thrown server error.

### 4. Self-learning single-flight guard

- clone a dedicated personality for the test;
- send two concurrent `/api/atman/self-learn` requests for the same personality;
- verify one request succeeds with `200`;
- verify the second returns `409` with conflict details.

### 5. Personality event persistence

- run clone, self-learning, and ethics-change actions;
- verify live events and persisted learning-ledger events contain all three categories.

### 6. Observation consent defaults

- start the runtime with no observation flags enabled;
- verify Atman reports that observation is off by default;
- verify no observation events are emitted before explicit consent.

### 7. Observation scope escalation

- enable minimal observation with `!observe on`;
- verify only safe local scopes become active;
- request `audio` and `screen` scopes separately;
- verify each scope requires an explicit additional approval step.

### 8. Observation learning report

- generate a short operator workflow with window changes and typing activity;
- trigger `!report now`;
- verify the report includes learned patterns, uncertainty, and at least one clarification question when confidence is low.

### 9. Observation privacy guardrails

- simulate password-like or payment-like contexts;
- verify the observation layer redacts or drops sensitive content;
- verify the learning ledger stores summaries only, not raw observation artifacts.

### 10. Observation and Ultra coexistence

- run Ultra with observation disabled;
- run Ultra with observation summaries enabled;
- verify Ultra can optionally consume observation summaries without failing when they are absent.

## Broader Regression Commands

- `npm run beta:test`
- `npm run beta:admin`
- `npm run beta:scenarios`
- `npm run beta:chaos`
- `npm run check`

## Approval Threshold

Changes are not ready for DeepSeek approval when any core runtime scenario above is untested or when any required command fails.
