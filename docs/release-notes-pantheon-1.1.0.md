# Pantheon 1.1.0 Release Notes

Pantheon 1.1.0 is the stabilized release after Social Phase 4 governance, sandbox operator hardening, code-quality governance, nightly regression automation, and runtime coverage over real suites.

## Highlights

- nightly beta automation now runs backend, admin, scenario, and two validated load profiles, uploads artifacts, and reuses a single open regression issue instead of opening duplicates;
- runtime coverage is now measured against real beta/admin/scenario/load suites through `coverage:runtime` and enforced in CI;
- social governance load coverage now includes coalition/conflict throughput, while load testing also covers `social-rooms` together with active observation;
- beta regression coverage now includes trust-sensitive Ultra synthesis and sandbox crash continuity across social traffic;
- repository dependency governance stays manual-review-first with Dependabot targeting `main` and bounded update fan-out.

## Validation

Validated for 1.1.0 with:

- `npm run verify:quality`
- `npm run beta:test`
- `npm run beta:admin`
- `npm run beta:load`
- `npm run beta:scenarios`
- `npm run coverage:runtime`

Measured runtime coverage for the exercised runtime slice:

- `Lines`: `71.13%`
- `Statements`: `71.13%`
- `Functions`: `87.86%`
- `Branches`: `60.23%`

## Release Notes

- this release folds the former `1.1.0-rc1` stabilization work into a publishable `1.1.0` package;
- the nightly workflow is intentionally configured with validated load parameters rather than stress-level settings so it remains a reliable regression signal;
- the runtime coverage gate is based on measured suite-backed coverage, not on synthetic or unverified thresholds.
