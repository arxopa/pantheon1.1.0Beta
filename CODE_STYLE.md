# Code Style

## Baseline

- Use Prettier for formatting. Do not hand-tune whitespace in files covered by the formatter.
- Respect `.editorconfig` for indentation, line endings, and final newline behavior.
- Prefer explicit names for runtime payloads and status objects such as `*State`, `*Status`, `*Report`, and `*Result`.
- Keep browser-only code in `src/` or `static/`. Do not import server runtime modules into UI code.
- Keep test helpers inside `server/testing/`. Runtime modules must not depend on them.

## Type Safety

- Run `npm run typecheck` before opening a PR.
- Avoid `any` when a concrete shape or `unknown` plus narrowing is available.
- Extend existing types instead of threading ad-hoc object literals through multiple layers.

## Runtime Boundaries

- Shared runtime concerns belong in `server/core/`.
- Social state belongs in `server/social/`.
- Integration-specific resilience belongs in the owning integration module.
- Operator-facing static assets must talk to the runtime only through HTTP or WebSocket APIs.

## Validation

Run the following locally before pushing:

```sh
npm run format
npm run typecheck
npm run check:deps
npm run audit:ci
npm run check
npm run quality:test
```
