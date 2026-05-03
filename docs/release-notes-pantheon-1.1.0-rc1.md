# Pantheon 1.1.0 RC1 Release Notes

Superseded by `docs/release-notes-pantheon-1.1.0.md` after final release validation.

Pantheon 1.1.0 RC1 is the first release-candidate snapshot after the Social Phase 4 governance work and the repository-wide code-quality hardening.

## Highlights

- nightly beta automation now runs backend, admin, scenario, and two load profiles, then uploads beta reports as artifacts;
- runtime coverage is no longer limited to the quality verifier: `coverage:runtime` executes real beta suites under `c8` and is wired into CI;
- load testing now includes `social-governance` throughput plus `social-rooms` with active observation;
- beta coverage now includes sandbox crash continuity and trust-sensitive Ultra synthesis;
- Dependabot policy is pinned to `main`, keeps manual review, and safely increases the concurrent PR window.

## New Validation Surface

Validated for this candidate with:

- `npm run verify:quality`
- `npm run beta:test`
- `npm run beta:admin`
- `npm run beta:load`
- `npm run beta:scenarios`
- `npm run coverage:runtime`

Measured runtime-coverage baseline for this candidate:

- `Lines`: `71.13%`
- `Statements`: `71.13%`
- `Functions`: `87.86%`
- `Branches`: `60.23%`

## Release Candidate Notes

- this candidate is intended as a stabilization milestone before a final `v1.1.0` publication;
- the new nightly workflow is designed to catch regressions in operator, social, sandbox, and observation coexistence paths before manual release review;
- the runtime coverage gate is intentionally bootstrapped from measured real-suite coverage instead of an unverified blanket threshold.
