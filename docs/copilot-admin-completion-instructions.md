# Copilot Instructions: Finish The Admin Panel

## Goal

Complete the admin plane as a secure operator surface without re-implementing systems that already exist.

## Critical Correction Before Editing

Do not follow the outdated assumption that admin auth is still missing.

The current repository already has:

- optional HTTP Basic Auth for `/admin` and `/admin.html`;
- bearer-token protection for protected operator APIs;
- beta coverage for unauthorized and authorized admin access;
- observation Phase 0 endpoints and admin controls.

Because of that:

1. do not add `express-basic-auth`;
2. do not migrate the runtime to Express just to add auth;
3. do not add a second parallel observation API under `/api/observe/*` while `/api/atman/observe/*` already exists;
4. do not reopen public routes such as chat in the name of admin cleanup.

## Primary Implementation Targets

### 1. Lock Down Admin Route Coverage

Audit the protected route list in `server/agent-runtime.mjs` and keep it current.

Copilot should:

1. review the existing protected admin API prefix list and the public Atman exceptions;
2. check whether any operator-only route still sits outside the protected set;
3. extend negative auth coverage in beta tests when new protected routes are added;
4. preserve backward compatibility for the existing env-based auth path.

Success condition:

- every operator-only endpoint returns `401` without credentials or bearer token when auth is configured.

### 2. Finish The Operator Workflow In `static/admin.html`

The admin panel should feel complete for a human operator, not just expose raw buttons.

Copilot should:

1. keep the existing bearer-token flow and make auth state obvious in the UI;
2. improve visibility for protected request failures and expired/missing token states;
3. make observation status, consent scopes, and latest report/data snapshots easier to inspect;
4. make scheduler task-plan results readable after manual runs;
5. avoid creating a second admin surface outside the current panel.

Success condition:

- an operator can authenticate once, inspect observation status, run scheduler tasks, and understand failures directly from the admin plane.

### 3. Add Operator Audit Logging

Admin completion is not just about auth. It also requires traceability.

Copilot should add a concise audit trail for:

- protected admin writes;
- observation enable/disable and report generation;
- manual scheduler runs;
- self-learning triggers;
- auth-relevant admin configuration changes.

Requirements:

1. store concise metadata, not secrets;
2. keep the log operator-readable;
3. expose it through the existing runtime/admin surfaces rather than a separate subsystem.

### 4. Add Rate Limiting To High-Impact Protected Routes

Prioritize runtime safety over breadth.

Start with:

- protected `/api/atman/*` write endpoints;
- self-learning and scheduler run endpoints;
- observation control/report endpoints;
- other high-impact protected admin APIs.

Requirements:

1. keep read-only endpoints less restrictive unless abuse risk is high;
2. make rate-limit failures visible and explicit to the operator;
3. preserve existing beta behavior where appropriate.

### 5. Extend Observation Only From The Current Phase 0 Baseline

The admin task and the observation task now meet in the same surface.

Copilot should:

1. build on `server/observation/` and `/api/atman/observe/*`;
2. preserve explicit consent and metadata-first capture;
3. keep data bounded in memory unless a later approved phase changes retention;
4. prefer aggregated reports and operator-visible summaries over raw capture artifacts.

## Validation Requirements

After any substantive admin-plane change:

1. run `npm --prefix /Users/ogr/Dots2 run beta:test` if runtime or protected endpoints changed;
2. run `npm --prefix /Users/ogr/Dots2 run beta:admin` if admin UI or auth behavior changed;
3. run `npm --prefix /Users/ogr/Dots2 run check` before approval;
4. if scenario orchestration changed, also run `npm --prefix /Users/ogr/Dots2 run beta:scenarios`.

## Documentation Requirements

When the admin plane changes, update:

- `README.md` for operator-facing environment or usage changes;
- `docs/lastchanges.md` with a concise factual summary;
- any DeepSeek-facing report if the change affects approval assumptions.

## Definition Of Done

The admin panel can be treated as complete for this stage when all of the following are true:

1. protected route coverage is explicit and regression-tested;
2. the current auth path is preserved and operator-visible in the UI;
3. observation and scheduler controls are usable without guesswork;
4. operator actions leave an audit trail;
5. high-impact protected routes are rate-limited;
6. validation remains green.
