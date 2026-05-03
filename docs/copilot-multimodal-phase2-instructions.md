# Copilot Instructions: Multimodal Phase 2

## Goal

Extend the current multimodal generation baseline without replacing the already working Phase 1 orchestration.

Phase 2 should improve quality, provider flexibility, personality fit, and operator visibility while preserving the current safety and validation posture.

## What must stay true

1. Keep the existing `server/integrations/personality-multimodal.mjs` backend path reusable.
2. Keep dialogue-first generation through the current `!generate` control-command surface.
3. Preserve ethical gating before expensive or unsafe generation work starts.
4. Preserve observation-driven `suggested_actions` as the bridge between observation and generation.
5. Do not fork a second unrelated multimodal subsystem.

## Primary implementation targets

### 1. Provider flexibility

Add provider selection behind stable adapters instead of hardwiring one backend.

Priorities:

- images: local Stable Diffusion / ComfyUI style adapter first, hosted provider second;
- audio: higher-quality voice provider plus a fallback stub path;
- video: storyboard-safe provider path first, richer video provider second.

Required outcome:

- generation can choose a provider through config without changing the command contract.

### 2. Personality-aware multimodal settings

Move generation preferences into personality configuration.

Suggested shape:

```json
{
  "multimodal": {
    "imageProvider": "local-sd",
    "audioProvider": "elevenlabs",
    "videoProvider": "storyboard",
    "style": {
      "palette": ["amber", "slate"],
      "imageTone": "architectural, expressive, safe",
      "voice": "calm-analytical",
      "music": {
        "genre": "ambient",
        "tempo": 92
      }
    }
  }
}
```

Required outcome:

- image, audio, and video prompts can be shaped by personality defaults instead of a flat global style.

### 3. Async queue status and cancellation

Phase 1 has a bounded in-memory queue.
Phase 2 should make it operator-visible.

Add:

- `!generate status`
- `!generate cancel <jobId>`
- admin-panel queue visibility for pending and running jobs

Required outcome:

- long-running jobs, especially video, expose progress, state, and cancellation.

### 4. Stronger moderation

Replace the current keyword-only safety baseline with a two-step moderation model.

Required checks:

- pre-generation prompt review through a small classifier or LLM safety pass;
- post-generation artifact review when the provider or artifact type supports it.

Required outcome:

- moderation is more robust than stop-word matching while still keeping a local fallback path.

### 5. Result caching

Add artifact caching keyed by a stable multimodal generation hash.

Cache key inputs should include:

- modality;
- normalized prompt or text;
- selected provider;
- relevant personality style fields;
- important generation parameters.

Required outcome:

- identical requests can reuse prior artifacts instead of repeating expensive work.

### 6. OpenAPI expansion

Document the next multimodal surfaces explicitly.

Expected additions:

- `/api/multimodal/generate`
- `/api/multimodal/queue/status`
- `/api/multimodal/queue/cancel`

Required outcome:

- external integrations can see the multimodal contract without reading server internals.

## Validation requirements

After any substantive Phase 2 implementation change:

1. run `npm --prefix /Users/ogr/Dots2 run beta:test`;
2. run `npm --prefix /Users/ogr/Dots2 run beta:admin` if queue visibility, auth state, or admin controls changed;
3. run `npm --prefix /Users/ogr/Dots2 run beta:scenarios` if observation, Ultra, or cross-personality orchestration changed;
4. run `npm --prefix /Users/ogr/Dots2 run check` before approval.

## Definition of done for Phase 2

Phase 2 can be considered complete when all of the following are true:

1. multiple providers can be selected through config;
2. personalities can shape multimodal generation defaults;
3. long-running jobs expose status and cancellation;
4. moderation is stronger than keyword-only blocking;
5. repeated prompts can hit cache safely;
6. OpenAPI documents the multimodal contract;
7. validation remains green.
