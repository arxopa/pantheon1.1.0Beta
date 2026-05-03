# Docs-Only PR Package For The Atman Observation Milestone

## Purpose

This file packages the current observation-instruction work into a docs-only pull request plan that is compatible with the repository's DeepSeek approval and docs-sync process.

## Scope Of This Package

The docs-only package currently covers:

- `docs/copilot-atman-observation-instructions.md`
- `docs/copilot-atman-observation-backlog.md`
- `docs/copilot-test-scenarios.md`
- `docs/pantheon.md`
- `docs/lastchanges.md`

## Why This Must Stay Docs-Only

The current repository worktree also contains non-doc runtime and test changes.
Those changes should not be mixed into the observation-instruction pull request if the goal is to publish guidance only.

For this PR, Copilot should isolate documentation changes from runtime code changes before pushing.

## Suggested Branch Intention

Use a branch name similar to:

- `docs/atman-observation-brief`

## Suggested PR Title

- `docs: add Copilot brief and rollout backlog for Atman observation milestone`

## Suggested PR Description

```md
## Summary

- add a repository-specific Copilot brief for extending Atman into a local real-time observer
- add a step-by-step implementation backlog for the observation milestone
- extend Copilot regression scenarios with observation consent, privacy, and reporting checks
- update the Pantheon dossier and lastchanges report for DeepSeek

## Why

This PR prepares the repository documentation for the next planned Atman milestone: explicitly consented local observation, multimodal understanding, structured learning reports, and clarification questions before any generation-first work.

## Validation

- npm --prefix /Users/ogr/Dots2 run check
```

## Local Isolation Checklist

Before pushing this docs-only package, Copilot should verify that only the intended docs files are included.

1. inspect `git status`;
2. avoid bundling unrelated runtime or personality-data changes;
3. ensure `docs/lastchanges.md` reflects the observation-instruction update;
4. run `npm --prefix /Users/ogr/Dots2 run check`;
5. push through the normal docs-sync-compatible PR flow.

## Mixed Worktree Safe Path

The current repository often has a mixed worktree with runtime, test, personality-data, and docs changes at the same time.
When that is true, Copilot should not try to create a docs-only branch by blindly switching branches and carrying the whole worktree.

Use a staging-only flow instead:

1. inspect `git -C /Users/ogr/Dots2 status --short`;
2. stage only the intended docs files with explicit paths;
3. verify staged content with `git -C /Users/ogr/Dots2 diff --cached --name-only`;
4. create the docs-only commit from the staged set only;
5. leave non-doc runtime changes unstaged or move them to a separate feature branch later.

Suggested path set for the current docs-only publication flow:

- `docs/lastchanges.md`
- `docs/copilot-optimization-instructions.md`
- `docs/copilot-atman-observation-instructions.md`
- `docs/copilot-atman-observation-backlog.md`
- `docs/copilot-test-scenarios.md`
- `docs/deepseek-observation-docs-pr-package.md`
- `docs/pantheon.md`

Suggested commit message:

- `docs: update observation and optimization guidance for DeepSeek review`

## DeepSeek Re-Read Summary

The current docs package reflects the latest DeepSeek instruction set in these ways:

1. it keeps generation work explicitly blocked until observation is stable;
2. it covers text, audio, and video analysis rather than text-only monitoring;
3. it requires learning reports and clarification questions as first-class behavior;
4. it ties the new observation work into the existing event stream, learning ledger, Ultra mode, and admin surfaces;
5. it treats privacy, consent, and local-only retention as critical design constraints.

## GitHub Workflow Notes

Because the repository uses PR-based docs sync:

1. the docs PR should target a branch, not direct push to protected `main`;
2. GitHub may normalize markdown files on the PR source branch;
3. docs-only changes can proceed without the `deepseek-approved` label under the current policy;
4. any future code implementation of the observation milestone will be a separate non-doc change set and should follow the stricter approval path.
