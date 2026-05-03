# Component Sandboxing Plan

## Purpose

This note captures the next-priority sandboxing plan for risky or resource-heavy Pantheon components.
It is intentionally practical: process boundaries first, resource controls second, container isolation third.

## Components To Isolate First

1. browser automation and NetSurfer-style navigation workers;
2. image, audio, and video generation backends;
3. long-running social live-stream helpers if they gain heavier transcript processing;
4. any future external model adapters that execute arbitrary prompts or large conversions.

## Execution Model

Preferred order:

1. separate Node child processes for unstable or high-cost components;
2. `worker_threads` only for trusted CPU-bound logic that still shares the same deployment trust boundary;
3. Docker containers for the highest-risk components or components that need filesystem or network restrictions beyond what a local child process can safely provide.

Recommended baseline contract:

- parent runtime owns orchestration, auth, audit, and queueing;
- sandbox worker owns exactly one capability surface;
- parent and worker communicate through JSON messages over IPC or loopback HTTP;
- every request carries a timeout, request id, and bounded payload size.

## Runtime Rules

- never execute browser or media generation in the main HTTP process when it can block dialogue or operator APIs;
- prefer asynchronous queue submission over synchronous waiting for expensive media jobs;
- restart failed workers with bounded exponential backoff;
- keep worker stdout and stderr structured enough to flow into operator audit and troubleshooting.

## Resource Controls

- use per-worker timeouts for navigation and media jobs;
- set explicit Node memory ceilings for heavy workers such as `--max-old-space-size`;
- bound concurrent jobs at the queue layer before they reach the worker;
- isolate temporary files per worker session under a dedicated tmp root;
- kill hung workers instead of letting the main runtime wait indefinitely.

## Security Controls

- keep the main runtime as the only holder of privileged admin tokens;
- pass short-lived scoped task payloads into workers instead of global secrets;
- give browser sandboxes read-only filesystem views unless writing artifacts is required;
- disable outbound network for workers that do not need it;
- log all sandbox starts, stops, crashes, and forced terminations through the operator audit path.

## Suggested Repo Shape

- `server/sandbox/browser-worker.mjs`
- `server/sandbox/media-worker.mjs`
- `server/sandbox/worker-supervisor.mjs`
- `server/sandbox/sandbox-protocol.mjs`
- `server/sandbox/docker/` for container recipes only when process isolation is no longer sufficient.

## Validation Sequence

1. unit-check the worker protocol and timeout handling;
2. beta-test one successful task and one forced-timeout task per worker type;
3. beta-test worker restart after a synthetic crash;
4. load-test queue backpressure before enabling the worker in the main admin flow.

## Immediate Next Step

The first practical implementation slice should isolate browser automation and video generation behind a single worker supervisor while leaving the current dialogue path non-blocking.
