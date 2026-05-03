# Pantheon Project Structure

## Overview

Pantheon is a multi-surface AI runtime that combines a React control plane, a Node.js ESM runtime, a personality-driven dialogue system, guarded self-learning, testing harnesses, dataset tooling, and operator-facing admin surfaces.

Current local workspace path:

- `/Users/ogr/Dots2`

Public repository:

- `https://github.com/arxopa/pantheon1.0`

## Top-Level Layout

### Root

- `README.md`: main project overview and operating description.
- `package.json`: scripts, dependencies, and quality gates.
- `index.html`: Vite entry page.
- `vite.config.*`: Vite configuration.
- `tsconfig*.json`: TypeScript build configuration.
- `.gitignore`: excludes generated and runtime artifacts from version control.

### `src/`

Frontend control plane built with React and TypeScript.

- `App.tsx`: top-level composition of the main UI.
- `components/`: architecture, runtime, learning, integration, trace, and protocol panels.
- `lib/`: runtime client and helper logic.
- `data/`: frontend-side domain models.
- `types/`: shared frontend typing surfaces.

### `static/`

Operator-oriented HTML surfaces outside the main React shell.

- `admin.html`: direct admin console for runtime inspection, events, Ultra smoke flow, media tools, and beta checks.
- `chat_index.html`: alternate static chat entry.

### `server/`

Node.js ESM runtime and backend subsystem root.

- `agent-runtime.mjs`: main HTTP runtime and composition root.
- `core/`: runtime hardening and lower-level control utilities.
- `dialog/`: Atman dialogue engine, personality manager, templates, history, and events.
- `agents/`: specialist expert-agent modules with a shared base contract and registry.
- `integrations/`: external bridge and bot integrations.
- `interests/`: child-interest tracking and related state.
- `linguistic/`: intent, tone, and linguistic routing helpers.
- `navigation/`: browser and navigation behavior.
- `reporting/`: report rollover and documentation-maintenance automation.
- `research/`: web-scout and evidence-gathering helpers.
- `self_learning/`: ledger, Rishi analysis, resonance monitoring, preflight, and self-learning flows.
- `testing/`: beta, admin, scenario, load, chaos, and soak testing harnesses.
- `training/`: curation, ingestion, export, registry, evaluation, and training preparation tools.
- `validation/`: validator and truth/safety checks.

Planned next backend additions for the Atman observation milestone:

- `observation/`: local activity collection, consent policy, screen and audio observers, bounded context queue.
- `analysis/`: intent inference, anomaly detection, multimodal fusion, and learning report generation.

### `docs/`

Project operating notes, release notes, scenario docs, and transfer reports.

Important files now include:

- `release-notes-pantheon-1.0.md`
- `release-notes-pantheon-1.1.0.md`
- `release-notes-pantheon-1.1.0-rc1.md`
- `release-announcement-pantheon-1.0.md`
- `specialist-agents-phase1.md`
- `gitpath.md`
- `fordeepseek.md`
- `lastchanges.md`
- `copilot-atman-observation-backlog.md`
- `deepseek-observation-docs-pr-package.md`
- `deepseek-pantheon-report-2026-05-02.md`
- beta, ethics, template, multimodal, and training documentation.

### `.github/workflows/`

Repository automation and governance rules.

- `ci.yml`: formatter, typecheck, dependency-boundary, audit, quality coverage, and runtime coverage validation.
- `nightly-beta.yml`: scheduled and manual beta regression workflow with artifact upload and automatic issue creation on failure.
- `docs-sync.yml`: automatic normalization and push-back of markdown updates under `docs/` when the repository workflow is triggered from GitHub.
- `deepseek-approval.yml`: pull-request gate that blocks non-doc changes unless the PR carries a `deepseek-approved` label.
- `security-audit.yml`: scheduled dependency audit.
- `autofix.yml`: formatter autofix on pull requests.

### `data/`

Dataset and export surfaces.

- `curated/`
- `datasets/`
- `exports/`
- `raw/`

## Runtime Structure

## `server/agent-runtime.mjs`

This is the main server entry and the most important backend file.
It is responsible for:

- HTTP endpoint composition;
- Atman chat routing;
- Pantheon Ultra orchestration;
- event and audit exposure;
- learning and validation endpoint wiring;
- integration and operator utility endpoints.

Ultra-specific runtime additions include:

- session lifecycle helpers;
- read-only Ultra session listing;
- expert serialization for admin views;
- synthesis and contradiction metadata;
- fallback evidence handling in self-learning paths.

## Dialogue And Personality Layer

### `server/dialog/atman.mjs`

Core dialogue engine and response generation surface.

### `server/dialog/atman-personality-manager.mjs`

Central state manager for personalities, ethics, self-learning mutations, event generation, social simulation, template cloning, and expert routing.

### `server/dialog/personality-factory.mjs`

Shared template catalog and personality normalization layer.

## Ultra Mode

Pantheon Ultra is a temporary ensemble mode rather than a permanent stored personality.

Key user commands:

- `!ultra <query>` starts expert routing and synthesis.
- `!normal` exits Ultra and returns to standard dialogue mode.

Pipeline:

1. parse command and resolve current user session;
2. select specialist experts;
3. run expert turns;
4. synthesize one answer;
5. validate safety;
6. persist session state for follow-up turns;
7. expose operator metadata through admin and session endpoints.

## Learning, Audit, And Persistence

### `server/self_learning/learning-ledger.mjs`

Persistent JSON-backed learning ledger for cycles, memory shards, facts, nightly runs, checkpoints, and selected runtime events.

### `server/self_learning/rishi.mjs`

Higher-level analysis layer that computes gradients, interprets degradation signals, and proposes rollback-aware recommendations.

### Related files

- `resonance-monitor.mjs`
- `preflight.mjs`
- `deep-self-learning.mjs`
- `inspector.mjs`

## Testing Surface

### Main commands

- `npm run beta:admin`
- `npm run beta:test`
- `npm run beta:scenarios`
- `npm run beta:load`
- `npm run verify:quality`
- `npm run quality:coverage`
- `npm run coverage:runtime`
- `npm run check`

### Main test files

- `server/testing/admin-ui-beta.mjs`
- `server/testing/beta-test-runner.mjs`
- `server/testing/personality-scenario-runner.mjs`
- `server/testing/chaos-test.mjs`
- `server/testing/load-test.mjs`
- `server/testing/runtime-coverage-runner.mjs`
- `server/testing/soak-test.mjs`

Current specialist-agent runtime files:

- `server/agents/base-agent.mjs`
- `server/agents/specialist-agent-registry.mjs`

## Current Operator Model

Pantheon is explicitly operator-first.
The project is built around visibility into:

- runtime health;
- event streams;
- learning state;
- Ultra session behavior;
- multimodal stubs;
- validation incidents;
- branchable admin smoke flows.

The next planned operator-facing extension is an explicitly consented observation layer for Atman.
That milestone is intended to add local activity awareness, multimodal understanding, clarification questions, and structured learning reports before any generation-first multimodal training work starts.

The current stabilization layer also adds a nightly regression loop, real runtime coverage, and release-candidate preparation around the already implemented observation, social, sandbox, and operator surfaces.

That stabilization layer is now carried into the validated `1.1.0` release package, while the next implementation branch starts with specialist expert agents under `server/agents/`.

This design is visible both in the React control plane and in `static/admin.html`.

## Report Files For DeepSeek

The current report package for DeepSeek is:

- `docs/fordeepseek.md`: cumulative work history;
- `docs/pantheon.md`: project-structure dossier;
- `docs/lastchanges.md`: latest repository-level changes only.
- `docs/copilot-optimization-instructions.md`: repo-specific Copilot workflow guidance.
- `docs/copilot-test-scenarios.md`: regression scenarios Copilot should preserve.
- `docs/copilot-atman-observation-instructions.md`: implementation brief for the Atman observation milestone.
- `docs/copilot-atman-observation-backlog.md`: file-by-file rollout backlog for the observation milestone.
- `docs/deepseek-observation-docs-pr-package.md`: docs-only PR package and isolation checklist for publishing the observation brief.

The maintenance workflow is now:

- prepare the next latest-change snapshot as markdown;
- run `npm run report:deepseek -- --source <snapshot.md> --title <entry title>`;
- let the GitHub docs workflow normalize markdown updates inside `docs/`.

Old RTF transfer files have been retired in favor of markdown to make the reports diffable, repo-native, and easier to update over time.
