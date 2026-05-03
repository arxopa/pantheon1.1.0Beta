# Last Changes

## Latest Repository-Level Actions

### 1. Copilot instruction set added for the Atman observation milestone

- added `docs/copilot-atman-observation-instructions.md` describing how Copilot should expand Atman into a real-time, explicitly consented local observer before any multimodal generation work begins;
- the new instruction package covers architecture, module boundaries, event and ledger integration, safety rules, report format, and clarification-question behavior.

### 2. Practical rollout backlog and docs-only PR package prepared

- added `docs/copilot-atman-observation-backlog.md` with a phase-by-phase implementation backlog tied to files, endpoints, validation steps, and rollout order;
- added `docs/deepseek-observation-docs-pr-package.md` with a docs-only pull request package, isolation checklist, PR title/body draft, and a summary of how the current docs reflect the latest DeepSeek instruction set.

### 3. Copilot regression scenarios extended for observation work

- expanded `docs/copilot-test-scenarios.md` with observation-specific checks for consent defaults, scope escalation, learning reports, privacy guardrails, and coexistence with Ultra;
- this makes the planned observation milestone testable before implementation starts.

### 4. Project dossier updated for the next Atman extension

- updated `docs/pantheon.md` so the repository dossier now includes the planned `server/observation/` and `server/analysis/` layers and references the new Copilot observation brief;
- this keeps the DeepSeek-facing documentation aligned with the next planned architecture phase.

### 5. Runtime hardening for Ultra and self-learning completed

- Ultra expert collection now isolates per-expert failures, records the failures, and returns a degraded fallback reply instead of throwing a server-wide `500` when all experts fail;
- self-learning now uses a per-personality in-memory lock so duplicate in-flight runs return `409 Conflict` instead of overlapping silently.

### 6. Beta coverage expanded for the new safety paths

- added permanent `beta:test` cases for admin auth guarding, degraded Ultra fallback behavior, and self-learning conflict handling;
- this turns the current hardening work into stable regression coverage instead of one-off manual checks.

### 7. Copilot approval guidance documented from verified repo state

- added `docs/copilot-optimization-instructions.md` with repository-specific editing and validation rules for future Copilot work;
- added `docs/copilot-test-scenarios.md` with the minimum runtime and governance scenarios to rerun before DeepSeek approval.

### 8. Branch-protection-compatible docs sync finalized

- changed `Docs Sync` so it now runs on pull requests and writes normalized `docs/` updates back to the PR source branch instead of pushing directly to `main`;
- this makes automatic GitHub-side docs normalization compatible with strict protected-branch rules.

### 9. DeepSeek approval gate made branch-protection-ready

- updated `DeepSeek Approval Gate` so it also runs on pushes to `main` as a no-op context publisher and keeps real enforcement on pull requests;
- this makes the approval gate visible as a stable GitHub status check that can be required by branch protection.

### 10. Strict DeepSeek-governed merge policy prepared for enforcement

- updated the DeepSeek approval policy so non-doc changes must go through a pull request branch, pass required checks, and carry DeepSeek approval before merge;
- this is the documented merge path for project changes once direct bypass of branch protection is disabled.

### 11. Repository path document added for DeepSeek

- added `docs/gitpath.md` with the full local repository path, Git remote URL, and public GitHub repository URL;
- updated `docs/pantheon.md` so the report set explicitly includes `gitpath.md`.

### 12. Docs-wide formatting contract completed

- expanded `format` and `format:check` to cover `.github/workflows/*.yml` and `docs/**/*.md` instead of a partial hand-picked file list;
- normalized existing markdown files in `docs/` that were previously outside the standard formatting gate, so the whole docs tree now participates in automated GitHub updates cleanly.

### 13. Admin authentication is implemented, not just tested

- the runtime already protects `/admin` and `/admin.html` with optional HTTP Basic Auth when `ADMIN_USER` and `ADMIN_PASS` are configured;
- protected admin APIs also support bearer-token checks so the static admin console can authenticate without exposing credentials in every request;
- `beta:test` and `beta:admin` now validate this path as a real runtime behavior, not only as a planned requirement.

### 14. Observation Phase 0 is now implemented in the runtime and admin plane

- added the `server/observation/` runtime layer with bounded in-memory observation state, consent-aware queueing, and safe activity collection for window and typing metadata;
- added observation endpoints for status, control, report generation, and data snapshots, plus `!observe ...` and `!report now` control commands;
- extended the admin panel with observation controls so operators can enable, inspect, sample, and report on the current observation session.

### 15. Atman scheduler expanded from one task into a task-plan runner

- Atman scheduler configuration now persists a structured `taskPlan` instead of only an interval and daily budget;
- manual and scheduled runs can now execute Monte Carlo self-learning, network research, deep-cycle analysis, architecture review, and observation-report generation;
- the admin UI now loads, saves, and triggers this richer scheduler plan for each personality.

### 16. Regression coverage updated for observation and scheduler work

- `beta:test` now covers the observation status/control/report/data flow and the richer scheduler task-plan runtime path;
- event-feed reads were adjusted so key lifecycle events like `personality-cloned`, `personality-self-learned`, and `ethics-manually-configured` remain visible in limited personality-scoped responses;
- latest focused validation passed with `26/26` beta cases green and `6/6` admin cases green.

### 17. DeepSeek-facing admin review and Copilot admin-completion brief added

- added `docs/deepseek-admin-panel-review-2026-05-02.md` so the latest DeepSeek review can use the live repository state instead of the earlier incomplete assumptions about missing admin auth and missing observation implementation;
- added `docs/copilot-admin-completion-instructions.md` with a corrected completion plan for the admin panel that focuses on route coverage, audit logging, rate limiting, operator UX, and observation integration without re-implementing the existing auth path.

### 18. Admin plane now exposes an operator audit trail

- added a bounded in-memory operator audit log in `server/agent-runtime.mjs` and exposed it through the protected endpoint `/api/admin/audit-log`;
- the runtime now records failed admin auth attempts, admin page opens, observation-control actions, observation report generation, scheduler config changes, manual scheduler runs, and self-learning triggers;
- the static admin panel now shows the operator audit trail and clearer bearer-token state messaging, while beta coverage now verifies that the audit endpoint is protected and the admin UI loads the new audit surface.

### 19. Protected-route coverage and admin rate limiting were hardened

- expanded the protected operator-route coverage beyond the original admin prefixes so more operator-only surfaces now stay behind the existing bearer-token gate;
- added focused rate limiting for high-impact protected admin routes such as observation control, observation reporting, scheduler config, scheduler run, and self-learning when admin-token mode is enabled;
- added beta coverage for the new protected-route scope and for `429` behavior plus audit recording on rate-limited requests.

### 20. Observation privacy, ledger integration, and Ultra coexistence were extended

- observation capture now enforces a minimum sampling interval to avoid over-collecting metadata and reduce runtime churn;
- observation reports are now persisted into the learning ledger as `observation-insight` events instead of existing only in transient runtime memory;
- beta coverage now asserts that observation data stays metadata-only and does not expose raw typed content;
- `beta:scenarios` now verifies that Ultra mode and observation can run in parallel without breaking the Ultra session or observation reporting.

### 21. Baseline OpenAPI docs and improved load testing were added

- added a minimal OpenAPI spec generator in `server/openapi/pantheon-openapi.mjs` and exposed it through `/api/openapi.json` plus a lightweight `/api-docs` page;
- upgraded `beta:load` so it can exercise Ultra-oriented traffic, report `p95` latency, and optionally include an observation flow during load runs.

### 22. Multimodal Generation Phase 1 was wired into the dialogue path

- added `server/multimodal/audio-gen.mjs`, `image-gen.mjs`, `video-gen.mjs`, and `multimodal-queue.mjs` as a thin orchestration layer over the existing `PersonalityMultimodal` backend;
- added direct commands `!generate image <prompt>`, `!generate audio <text>`, and `!generate video confirm <prompt>`;
- added a Shiva-style ethical generation filter that blocks unsafe content and requires explicit confirmation for video generation;
- observation learning reports now expose `suggested_actions` so Atman can propose context-aware multimodal generation from observation signals;
- beta coverage now verifies the command path for image/audio/video generation plus unsafe-request blocking.

### 23. DeepSeek final approval text and Multimodal Phase 2 preparation were added

- added a short sendable DeepSeek approval note in `docs/deepseek-multimodal-phase2-approval-2026-05-02.md` confirming that the current reports are internally consistent and that Phase 1 is complete;
- added `docs/copilot-multimodal-phase2-instructions.md` to turn the next multimodal step into a concrete repo-level execution plan instead of an informal chat-only recommendation set;
- fixed the next-phase scope around six concrete targets: provider flexibility, personality-aware generation settings, async queue status and cancellation, stronger moderation, result caching, and OpenAPI expansion for multimodal integrations.

### 24. Multimodal Phase 2 first implementation slice is now in the runtime

- extended personality multimodal profiles so each personality can now persist `audioProvider`, `imageProvider`, `videoProvider`, and nested style settings such as palette, image tone, voice delivery, and music pacing;
- updated the existing `PersonalityMultimodal` backend to honor provider selection through config, shape prompts and descriptions from the personality multimodal style, and carry the selected provider into task and artifact metadata;
- upgraded the in-memory multimodal queue with explicit job records, progress percentage, async dispatch support, queue inspection, and cancellation state;
- added dialogue commands `!generate status` and `!generate cancel <jobId>` plus new runtime APIs `/api/multimodal/generate`, `/api/multimodal/queue/status`, and `/api/multimodal/queue/cancel` for queue-driven workflows;
- expanded the admin media panel so operators can edit provider and style settings per personality and inspect queue jobs alongside backend media tasks;
- validation is green after the change set: `beta:test` passed `29/29`, `beta:admin` passed `6/6`, and `check` was rerun after formatting fixes.

### 25. Multimodal Phase 2 moderation, caching, and OpenAPI were completed

- upgraded the multimodal safety path from a keyword-only gate into a two-step moderation flow with regex fallback, optional Ollama prompt review, and lightweight post-generation artifact review metadata;
- formalized multimodal result caching in the existing `PersonalityMultimodal` backend with TTL, bounded in-memory eviction, explicit cache status reporting, and cache clear controls;
- added the command `!generate cache clear` plus runtime endpoints `/api/multimodal/cache/status` and `/api/multimodal/cache/clear` for operator-visible cache management;
- expanded `server/openapi/pantheon-openapi.mjs` and `/api-docs` coverage so multimodal generate, queue, and cache endpoints are now present in the published API contract;
- extended regression coverage for stronger moderation, cache hits, cache clearing, and multimodal OpenAPI presence.

### 26. Social Phase 3 – Personality interaction and shared context

- [x] Реализован протокол обмена сообщениями между личностями через `/api/personality/talk` с внутренней последовательной доставкой и rate limiting.
- [x] Добавлена shared memory в `server/social/shared-context.mjs` для общих фактов, темы канала и истории недавних социальных сообщений.
- [x] В конфиг личности добавлено явное эмоциональное состояние `emotion`, которое обновляется на social exchange и влияет на стиль ответа.
- [ ] Добавлены команды управления комнатами (`!room create/list/send`).
- [ ] Реализован WebSocket для просмотра живых диалогов в админке.
- [x] Добавлены beta-проверки и OpenAPI-документация для social talk и shared context foundation.

### 27. Social Phase 3 – Rooms and live WebSocket monitoring

- [x] Реализованы комнаты поверх shared context через `server/social/social-room.mjs` и новые runtime endpoints `/api/personality/rooms*`.
- [x] Добавлены команды `!room create`, `!room list`, `!room send`, `!room leave` в прямой Atman chat path.
- [x] Добавлен WebSocket `/ws/social/room/<roomId>` с live-трансляцией room transcript и room events.
- [x] Админ-панель получила блок `Социальные комнаты` с созданием, выбором комнаты, отправкой сообщений и live-просмотром.
- [x] OpenAPI расширен room endpoints и WebSocket room stream path.
- [x] `beta:test` расширен room REST/WebSocket и `!room` chat command coverage.
- [x] `beta:admin` расширен smoke-сценарием для комнаты и live transcript в admin UI.
- [x] `beta:load` получил режим `social-rooms` для параллельных социальных разговоров в нескольких комнатах.

### 28. Social Phase 3 – Manual validation hardening and sandbox plan

- [x] Ручные проверки Social Phase 3 прогнаны на изолированном runtime с временным ledger/storage, без использования основной runtime state.
- [x] Подтверждено, что `POST /api/personality/shared-context` и `POST /api/personality/talk` создают social exchange в ledger и обновляют emotion у личности-адресата.
- [x] Исправлена совместимость `POST /api/personality/talk` с alias-полем `to`, чтобы ручные и внешние клиенты не зависели только от `targetPersonalityId`.
- [x] Подтверждено, что негативный social exchange переводит личность в `guarded`, и этот emotion реально меняет тон ответа в `POST /api/atman/personality-chat`.
- [x] Подтвержден social rate limiting: первые 6 сообщений проходят, 7-е получает `429 Too Many Requests`.
- [x] Добавлен отдельный operator audit event `social-talk-rate-limited` для наблюдаемости social `429` через `/api/admin/audit-log?type=social`.
- [x] `beta:test` усилен focused regression case на `to` alias, emotion carry-over и social rate-limit audit.
- [x] Добавлен repo-level sandbox plan в `docs/component-sandboxing-plan.md` для browser/media workers как следующего приоритета после social rooms.

### 29. Sandboxing foundation for browser and video workers

- [x] Добавлен `server/sandbox/manager.mjs` как общий manager для browser и video sandbox execution с таймаутами, логами, авто-перезапуском browser worker и ограничением video concurrency.
- [x] NetSurfer execution переведён с прямого runtime Playwright path на отдельный browser worker через `server/sandbox/browser-worker.mjs`.
- [x] Video generation переведена на isolated worker execution через `server/sandbox/video-worker.mjs` и `server/sandbox/video-task.mjs` с сохранением текущего artifact/cache contract.
- [x] Добавлены runtime endpoints `/api/sandbox/status` и `/api/sandbox/logs` для operator-visible sandbox observability.
- [x] `GET /api/netsurfer/status` теперь показывает sandbox metadata рядом с browser snapshot.
- [x] `beta:test` расширен sandbox observability checks и прошёл зелёным после интеграции: `34/34`.
- [x] При локальной регрессии из-за stale `prewarmed` reference в NetSurfer action path выполнен root-cause fix, после чего self-learn и scheduler beta cases снова стали зелёными.

### 30. Sandbox operator surface and crash resilience

- [x] Добавлена команда `!sandbox status` в control command path, чтобы operator мог получить browser/video sandbox status прямо из диалога.
- [x] Runtime получил защищённые control endpoints `/api/sandbox/restart` и `/api/sandbox/crash`, а read-only `/api/sandbox/status` и `/api/sandbox/logs` сохранены как operator-visible observability surface.
- [x] `server/sandbox/manager.mjs` теперь хранит crash/restart counters, lastCrash/lastRestart timestamps и manual restart counters для browser/video sandbox state.
- [x] `static/admin.html` получила карточку `Sandbox` с live status, логами и ручным restart browser/video workers через существующий bearer-token flow.
- [x] `beta:test` получил focused resilience cases на forced browser worker crash + auto-restart и на video concurrency limit.
- [x] `beta:admin` получил smoke coverage для sandbox card и ручного browser restart из admin UI.
- [x] Финальная валидация зелёная: `beta:test` `36/36`, `beta:admin` `8/8`.

### 31. Social Phase 4 – Relationships, coalitions/conflicts, and Ultra relation awareness

- [x] Добавлен persistent directed relationship store `server/social/relationship-matrix.mjs` с метриками `trust`, `affection`, и `dominance` для каждой пары личностей.
- [x] `server/social/social-channel.mjs` теперь обновляет relationship matrix после social exchange и возвращает relation metadata в social delivery payload.
- [x] `server/dialog/atman-personality-manager.mjs` и `server/dialog/atman.mjs` теперь прокидывают directed relationship context в prompt, поэтому прямой ответ личности учитывает доверие, симпатию и доминирование к собеседнику.
- [x] Runtime получил `GET/POST /api/personality/relationships` и команду `!relation show <personality>` для operator-visible relationship inspection.
- [x] `server/social/shared-context.mjs` и `server/social/social-room.mjs` расширены coalition/conflict state и room-level mutations для создания коалиций, присоединения, выхода, объявления и разрешения конфликтов.
- [x] Добавлены room endpoints `/api/personality/rooms/coalition/*` и `/api/personality/rooms/conflict/*`, а также chat-команды `!room coalition create/join/leave` и `!room conflict declare/resolve` в Atman chat paths.
- [x] Room broadcast теперь учитывает coalition membership, а direct delivery блокируется с `409`, если между участниками активен room conflict.
- [x] Ultra synthesis теперь видит inter-expert relationship metadata и может отмечать tension/компромисс прямо в deterministic и model-backed synthesis path.
- [x] OpenAPI расширен relationship и room coalition/conflict endpoints.
- [x] `beta:test` расширен focused Phase 4 coverage и финально зелёный: `39/39` (`server/testing/data/beta-reports/beta-test-2026-05-03T20-19-08-187Z.json`).

### 32. Social Phase 4 – Admin UI for coalitions and conflicts

- [x] `static/admin.html` получила отдельную карточку `Коалиции и конфликты` с выбором комнаты, созданием коалиции, добавлением/удалением участников, удалением коалиции, объявлением и разрешением конфликта.
- [x] В admin UI добавлена lightweight trust matrix по участникам выбранной комнаты на основе `/api/personality/relationships`.
- [x] Runtime расширен admin-friendly routes: `GET /api/personality/rooms/{roomId}`, `POST /api/personality/rooms/coalition/delete`, path-style `.../coalition/{coalitionId}/add|remove|delete`, и `.../conflict/{conflictId}/resolve`.
- [x] `server/social/shared-context.mjs` и `server/social/social-room.mjs` получили полный coalition lifecycle, включая delete.
- [x] `server/testing/admin-ui-beta.mjs` расширен end-to-end сценарием на coalition/conflict lifecycle через реальный admin UI.
- [x] `docs/social-guide.md` обновлён под Phase 4 admin governance surface.
- [x] Финальная валидация после operator slice зелёная: `beta:admin` `9/9` (`server/testing/data/beta-reports/beta-admin-2026-05-03T20-43-19-170Z.json`) и `beta:test` `39/39` (`server/testing/data/beta-reports/beta-test-2026-05-03T20-43-40-586Z.json`).

### 33. Code quality toolchain and governance

- [x] Расширен formatter scope до всего репозитория через `prettier --write .` и `.prettierignore`, а репозиторий приведён к единому стилю после реального прогона форматтера.
- [x] Сохранён и подтверждён `.editorconfig`, добавлен `CODE_STYLE.md`, а `CONTRIBUTING.md` и PR template обновлены под ручной запуск quality-gates и установку hooks.
- [x] В `package.json` добавлены quality scripts: `quality:test`, `quality:coverage`, `check:deps`, `audit:ci`, `verify:quality`.
- [x] Внедрены `commitlint` и новые git hooks `commit-msg` + `pre-push`, при сохранении существующего `pre-commit` через `.githooks`.
- [x] Добавлен `dependency-cruiser` c правилами границ между `server/`, `src/`, `static/` и test utilities.
- [x] Добавлены GitHub workflows для CI quality gate, weekly security audit и formatter autofix, а также `Dependabot` и issue templates.
- [x] Добавлен автоматический verifier `server/testing/quality-toolchain-check.mjs`, который воспроизводит негативные кейсы для formatter, typecheck, pre-commit, commit convention, dependency rules и security audit на временных фикстурах и temp-repo.
- [x] Реализован bootstrap coverage gate для verifier через `c8`; текущий подтверждённый baseline после прогона: `Lines 98.21%`, `Functions 100%`, `Branches 80.55%`, `Statements 98.21%`.
- [x] Финальная валидация зелёная: `npm run verify:quality` и `npm run quality:coverage` проходят полностью, `npm audit --audit-level=high` чистый.

### 34. DeepSeek-directed edit and debug workflow hardening

- [x] Структура правки кода стала более жёсткой: repo-wide formatter и hooks теперь переводят style drift из «ручной договорённости» в обязательный gate перед commit/push.
- [x] Структура дебага стала воспроизводимой: для code-quality добавлен отдельный verifier с falsifiable negative cases вместо разовых ручных проб.
- [x] Архитектурный дебаг теперь опирается на формальные dependency rules, которые сразу показывают недопустимые импорты между runtime, UI и test-утилитами.
- [x] Quality gate теперь разделён на уровни: focused local scripts, hook-level blocking, CI enforcement, scheduled security audit, и auto-fix для formatting drift.

### 35. Nightly beta automation, runtime coverage, and safe dependency governance

- [x] Добавлен GitHub workflow `.github/workflows/nightly-beta.yml` с nightly и manual trigger, прогоном `beta:test`, `beta:admin`, `beta:scenarios`, двумя load-профилями и artifact upload для `server/testing/data/beta-reports/`.
- [x] При nightly failure workflow теперь автоматически создаёт GitHub issue с ссылкой на упавший run и приложенными beta-report artifacts.
- [x] Добавлен `server/testing/runtime-coverage-runner.mjs` и npm script `coverage:runtime`, который гоняет реальные runtime suites под `c8` вместо verifier-only coverage.
- [x] `.github/workflows/ci.yml` расширен новым runtime coverage gate, а `Dependabot` теперь целится в `main` и держит manual-review-only policy с `open-pull-requests-limit: 10`.

### 36. DeepSeek follow-up tests A-E and release candidate `v1.1.0-rc1`

- [x] `server/testing/load-test.mjs` получил новый режим `social-governance` для coalition/conflict throughput и расширение `social-rooms + observation` с отдельным observation report id и health-check.
- [x] `server/testing/beta-test-runner.mjs` расширен новыми кейсами `ultra-relation-sensitive-synthesis` и `sandbox-crash-social-continuity`.
- [x] Runtime coverage gate (`coverage:runtime`) закрывает DeepSeek test E, а nightly/CI теперь прогоняют новые сценарии как first-class checks; подтверждённый baseline текущего runtime slice: `Lines 71.13%`, `Statements 71.13%`, `Functions 87.86%`, `Branches 60.23%`.
- [x] Подготовлен release-candidate документ `docs/release-notes-pantheon-1.1.0-rc1.md` и синхронизированы DeepSeek-facing docs под текущую стадию стабилизации.

### 37. Final release packaging for `v1.1.0`

- [x] Версия проекта в `package.json` поднята до `1.1.0`, а для финального пакета добавлены отдельные release notes `docs/release-notes-pantheon-1.1.0.md`.
- [x] `nightly-beta.yml` переведён на validated load parameters и на deduplicated issue flow c label `nightly-regression` вместо бесконтрольного создания новых issues.
- [x] `README.md` и `docs/fordeepseek.md` синхронизированы с финальным release state вместо `RC1`-формулировок.

### 38. Specialist agents Phase 1 scaffold

- [x] Добавлены `server/agents/base-agent.mjs` и `server/agents/specialist-agent-registry.mjs` как базовый execution contract и единый реестр экспертных модулей.
- [x] Реализованы первые независимые specialist agents: `mathanalysis`, `lingvoanalysis`, `artanalysis`, `medicalanalysis`, `legalanalysis`, `economicanalysis`, `codeanalysis`, `gametheoryanalysis`.
- [x] Runtime получил защищённые endpoints `GET /api/agent/catalog` и `POST /api/agent/{agentName}/{method}` плюс новый command path `!agent ...`.
- [x] OpenAPI обновлён под specialist-agent surface, а `beta:test` расширен новым case `specialist-agent-api-and-command`; текущий итоговый прогон: `42/42`.
- [x] Добавлен отчёт `docs/specialist-agents-phase1.md` с описанием реализации, рекомендованных новых блоков и следующих фаз внедрения.
