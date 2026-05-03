# Multimodal Guide

## Scope

This guide documents the currently implemented multimodal runtime behavior after Phase 1 and the first Phase 2 implementation slice.
It covers the dialogue commands, the queue model, provider and personality settings, the current safety rules, and the relation between observation and generation.

## What exists now

Pantheon already had repo-native media endpoints under `/api/atman/media/*`.
Phase 1 added a dialogue-first orchestration layer on top of them.
The current Phase 2 slice extends that same path instead of replacing it.

Implemented command surface:

- `!generate image <prompt>`
- `!generate audio <text>`
- `!generate video <prompt>`
- `!generate video confirm <prompt>`
- `!generate status`
- `!generate status <jobId>`
- `!generate cancel <jobId>`

These commands route through:

- `server/multimodal/image-gen.mjs`
- `server/multimodal/audio-gen.mjs`
- `server/multimodal/video-gen.mjs`
- `server/multimodal/multimodal-queue.mjs`

The queue uses the already validated backend in `server/integrations/personality-multimodal.mjs`.

## Personality and provider settings

Multimodal generation is now personality-aware.
Each personality can persist a multimodal profile with both provider selection and style defaults.

Current configurable fields include:

- `audioProvider`
- `imageProvider`
- `videoProvider`
- `ttsVoice`
- `style.palette`
- `style.imageTone`
- `style.voice`
- `style.music.genre`
- `style.music.tempo`

The current admin panel exposes these values through the Atman media profile controls.
They are stored through the existing `/api/atman/media/profile` route.

Generation behavior now uses those values to:

- choose a provider label per modality;
- shape image prompts from personality visual tone and palette;
- shape speech description from personality voice style;
- shape video storyboard prompts from personality visual and music defaults.

## Safety model

Every generation request is checked by the queue-level ethical filter before execution.

Current moderation path is now two-step:

- a fast regex-based local safety review runs first and blocks clear dangerous or privacy-breaking prompts;
- if `ATMAN_OLLAMA_MODEL` or `PANTHEON_MULTIMODAL_MODERATION_MODEL` is configured, an additional Ollama-based prompt review can run before generation;
- after generation, a lightweight artifact review is applied from artifact metadata and prompt/description surfaces as a local fallback.

Current behavior:

- unsafe prompts related to violence, weapons, explosives, terrorism, hacking, or similar harmful content are blocked;
- privacy-breaking prompts asking for secrets, passwords, tokens, or sensitive personal data are blocked;
- video generation is treated as an expensive action and requires explicit confirmation;
- blocked requests return a refusal payload instead of silently falling through to the media backend.

Current confirmation rule:

- `!generate video <prompt>` returns a confirmation-required message;
- `!generate video confirm <prompt>` proceeds with generation.

## Queue visibility and async control

The queue is still in-memory, but it is now operator-visible and command-visible.

Current queue behavior:

- jobs keep explicit status, stage, progress percentage, and timestamps;
- queue jobs can be submitted asynchronously through `/api/multimodal/generate` by setting `waitForCompletion: false`;
- queue state can be read through `!generate status` or `/api/multimodal/queue/status`;
- queue jobs can be cancelled through `!generate cancel <jobId>` or `/api/multimodal/queue/cancel`;
- `/api/atman/media/status` and `/api/atman/media/tasks` now expose queue state alongside backend multimodal task state.

## Cache behavior

Generated multimodal artifacts are cached behind the existing `PersonalityMultimodal` backend.

Current cache rules:

- cache keys include modality, normalized prompt or text, provider choice, and relevant personality/style fields;
- cache is bounded in memory and pruned by TTL plus insertion-order eviction;
- cache state is visible through `/api/multimodal/cache/status`;
- cache can be cleared through `/api/multimodal/cache/clear` or `!generate cache clear`.

## Observation integration

Observation reports now expose `suggested_actions`.
This lets Atman propose a fitting generation step after building a report from safe metadata.

Examples:

- if the observed context looks like UI or runtime editing, Atman can suggest an image concept;
- if the observed context looks like repository review, Atman can suggest a short audio summary;
- if the observed context looks like operator-panel validation, Atman can suggest a storyboard-style video walkthrough.

## Runtime behavior

The current implementation is intentionally bounded:

- the queue is in-memory;
- generation still reuses the existing validated media backend;
- provider flexibility is configured through the same backend path rather than a parallel system;
- the existing `/api/atman/media/*` endpoints remain the operator-facing media surface;
- the newer `/api/multimodal/*` endpoints are queue-oriented helpers for async workflows.

## Validation

Current multimodal coverage includes:

- image generation via dialogue command;
- audio generation via dialogue command;
- confirmation gating for video generation;
- unsafe-generation refusal;
- observation report `suggested_actions` presence;
- provider selection persistence through the multimodal personality profile;
- async queue job status and cancellation;
- stronger prompt moderation and cache-clear coverage;
- OpenAPI coverage for multimodal queue and cache endpoints;
- admin media-panel regression after provider/style controls were added.

## Next likely steps

- replace the current keyword-only moderation with the planned stronger two-step moderation model;
- expand cache policy from the current generation hash inputs into a more formal multimodal caching contract;
- document the `/api/multimodal/*` surfaces in the OpenAPI output;
- decide whether queue persistence is needed beyond the current in-memory operator workflow.
