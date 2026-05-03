# Copilot Optimization Instructions

## Purpose

This document defines the repository-specific workflow Copilot should follow before proposing or applying project changes for Pantheon.

## Verified Working Rules

1. Start from the nearest controlling surface.
   For runtime behavior, inspect the exact HTTP handler or core function first instead of mapping the whole repository.

2. Treat external reviews as hypotheses, not facts.
   DeepSeek notes, prior summaries, and stale search results must be verified against the live files before editing.

3. Prefer a narrow falsifiable change.
   For this repository, the most reliable flow is: identify one local failure mode, patch the smallest owning function, then run the cheapest test that can disconfirm it.

4. Protect the admin plane explicitly.
   Changes touching `static/admin.html` or sensitive `/api/atman/*`, `/api/inspector/*`, `/api/bridge/*`, `/api/telegram/*`, or `/api/runtime/status` routes must preserve the optional admin auth path.

5. Keep Ultra mode degradable, not brittle.
   Any change around expert routing, synthesis, or validation must preserve a non-500 fallback path when expert collection is partial or fully unavailable.

6. Keep self-learning single-flight per personality.
   Any change around Monte Carlo self-learning or scheduler triggers must preserve the in-memory conflict guard and `409` response for duplicate in-flight runs.

7. Do not widen behavior silently.
   New endpoints, scheduler triggers, or docs automation should stay consistent with branch protection, DeepSeek approval workflow, and existing public/private route boundaries.

## Verified Weak Spots To Re-check Before Approval

- Ultra mode is sensitive to expert failure, timeout, and routing regressions.
- Self-learning is sensitive to duplicate concurrent triggers and scheduler overlap.
- Admin surfaces are sensitive to accidental unauthenticated exposure when auth env vars are configured.
- Docs/governance changes are sensitive to branch-protection compatibility.

## DeepSeek Follow-Up From Lastchanges Review

The current repository state invalidates one part of the latest DeepSeek hypothesis: admin authentication is already implemented in the runtime.
Copilot should treat this as verified code, not as an open TODO, and avoid reopening the admin plane unless new protected routes are added.

What remains worth doing after the `lastchanges.md` review:

1. Extend observation beyond Phase 0 without breaking the current privacy contract.
   The next implementation step is OS-facing metadata collection behind explicit consent and capability checks, while keeping raw content retention disabled by default.

2. Keep the scheduler task-plan bounded and auditable.
   Any new scheduler task should be explicit in config, show up in the admin plane, and record operator-visible results or decision logs.

3. Preserve GitHub publication discipline.
   Copilot can publish reports to GitHub, but docs-only updates must stay isolated from runtime changes and protected-branch rules must continue to be respected.

4. Add operator-focused hardening before broader multimodal rollout.
   The highest-value next additions are rate limiting on protected APIs, an operator audit trail for admin actions, and queueing for long-running scheduler or learning tasks.

5. Treat OpenAPI and load testing as secondary work.
   API documentation and non-blocking Ultra load tests are useful, but they should not displace observation safety, admin hardening, or scheduler auditability.

## Priority Instructions For Copilot

### High Priority

1. Do not re-implement admin auth from scratch.
   Verify that new admin routes stay under the existing Basic Auth and bearer-token path in `server/agent-runtime.mjs`, and keep negative unauthorized checks in beta coverage.

2. Continue observation from the current Phase 0 baseline.
   Build on `server/observation/` instead of creating a parallel subsystem. Preserve explicit consent, local-only scope, metadata-first capture, and ledger summaries rather than raw artifact retention.

3. Keep reports GitHub-safe.
   Any report or status documentation intended for GitHub should be markdown-first, PR-based, and compatible with docs sync and DeepSeek approval rules.

### Medium Priority

1. Add operator audit logging for admin actions.
   Auth success, protected writes, scheduler runs, and observation enable/disable actions should leave a concise audit trail.

2. Queue long-running work instead of stacking it inline.
   Observation reporting, deep self-learning, and scheduler-triggered research should remain conflict-aware and avoid overlapping silently.

3. Add API-level rate limiting where the blast radius is highest.
   Start with protected admin and self-learning endpoints before public or read-only routes.

### Lower Priority

1. Add OpenAPI coverage for stable public and operator APIs.
2. Add an optional Ultra load test that reports latency and failure mix without blocking merges.
3. Generate scenario suggestions from real logs only after the operator audit path is in place.

## Required Validation Order

1. Run the narrowest affected validation first.
2. If runtime or API behavior changed, run `npm run beta:test`.
3. If admin behavior changed, also run `npm run beta:admin`.
4. If scenario orchestration changed, run `npm run beta:scenarios`.
5. If resilience or failure handling changed, run `npm run beta:chaos`.
6. Run `npm run check` before approval when TypeScript, build, or shared UI/runtime code changed.

## Change Approval Notes

- Project changes outside `docs/` still require the DeepSeek-governed approval path described in `docs/deepseek-approval-policy.md`.
- Generated or refreshed markdown should remain compatible with GitHub-side docs normalization.
