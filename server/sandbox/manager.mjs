import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    name: 'Error',
    message: String(error ?? 'Unknown error'),
    stack: null,
  };
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.floor(numeric)
    : fallback;
}

export class SandboxManager {
  constructor(options = {}) {
    this.auditLogger =
      typeof options.auditLogger === 'function' ? options.auditLogger : null;
    this.browserWorkerPath =
      options.browserWorkerPath ?? path.join(__dirname, 'browser-worker.mjs');
    this.videoWorkerPath =
      options.videoWorkerPath ?? path.join(__dirname, 'video-worker.mjs');
    this.browserTimeoutMs = normalizePositiveInteger(
      options.browserTimeoutMs ??
        process.env.PANTHEON_BROWSER_SANDBOX_TIMEOUT_MS,
      30000
    );
    this.videoTimeoutMs = normalizePositiveInteger(
      options.videoTimeoutMs ?? process.env.PANTHEON_VIDEO_SANDBOX_TIMEOUT_MS,
      60000
    );
    this.maxVideoTasks = normalizePositiveInteger(
      options.maxVideoTasks ??
        process.env.PANTHEON_VIDEO_SANDBOX_MAX_CONCURRENT,
      3
    );
    this.logLimit = normalizePositiveInteger(options.logLimit, 200);
    this.logs = [];
    this.browserQueue = Promise.resolve();
    this.browserState = {
      kind: 'browser',
      managed: true,
      child: null,
      pid: null,
      pending: new Map(),
      crashEvents: [],
      restartEvents: [],
      manualRestartCount: 0,
      restarts: 0,
      autoRestartScheduled: false,
      restartMode: null,
      status: 'stopped',
      lastStartedAt: null,
      lastCrashAt: null,
      lastRestartAt: null,
      lastExitedAt: null,
      lastError: null,
      totalRequests: 0,
      totalFailures: 0,
      nextRestartAt: null,
    };
    this.videoState = {
      kind: 'video',
      managed: true,
      children: new Map(),
      activeTasks: 0,
      maxConcurrent: this.maxVideoTasks,
      crashEvents: [],
      restartEvents: [],
      manualRestartCount: 0,
      totalRuns: 0,
      totalFailures: 0,
      totalTimeouts: 0,
      lastCrashAt: null,
      lastRestartAt: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastError: null,
    };
  }

  pruneRecentEvents(state, key) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    state[key] = (state[key] ?? []).filter((timestamp) => timestamp >= cutoff);
  }

  countRecentEvents(state, key) {
    this.pruneRecentEvents(state, key);
    return (state[key] ?? []).length;
  }

  pushRecentEvent(state, key) {
    state[key] = [...(state[key] ?? []), Date.now()];
    this.pruneRecentEvents(state, key);
  }

  recordLifecycleEvent(kind, worker, details = {}, summary = null) {
    const event = {
      kind,
      worker,
      summary: summary ?? `${worker} sandbox lifecycle event: ${kind}.`,
      details,
    };
    this.recordLog(event);
    this.auditLogger?.(kind, {
      worker,
      ...details,
    });
  }

  recordLog(event = {}) {
    this.logs = [
      ...this.logs,
      {
        id: event.id ?? `sandbox-log-${Date.now()}`,
        createdAt: event.createdAt ?? new Date().toISOString(),
        ...event,
      },
    ].slice(-this.logLimit);
  }

  getLogs(limit = 60) {
    return [...this.logs].slice(-Math.max(1, Number(limit ?? 60))).reverse();
  }

  getStatus() {
    const browserUptimeMs = this.browserState.lastStartedAt
      ? Math.max(
          0,
          Date.now() - new Date(this.browserState.lastStartedAt).getTime()
        )
      : 0;
    return {
      browser: {
        kind: this.browserState.kind,
        managed: true,
        activeWorkers: this.browserState.pid ? 1 : 0,
        timeoutMs: this.browserTimeoutMs,
        pid: this.browserState.pid,
        status: this.browserState.status,
        restarts: this.browserState.restarts,
        crashCountLastHour: this.countRecentEvents(
          this.browserState,
          'crashEvents'
        ),
        restartCountLastHour: this.countRecentEvents(
          this.browserState,
          'restartEvents'
        ),
        manualRestartCount: this.browserState.manualRestartCount,
        totalRequests: this.browserState.totalRequests,
        totalFailures: this.browserState.totalFailures,
        lastStartedAt: this.browserState.lastStartedAt,
        lastCrashAt: this.browserState.lastCrashAt,
        lastRestartAt: this.browserState.lastRestartAt,
        lastExitedAt: this.browserState.lastExitedAt,
        lastError: this.browserState.lastError,
        nextRestartAt: this.browserState.nextRestartAt,
        uptimeMs: browserUptimeMs,
      },
      video: {
        kind: this.videoState.kind,
        managed: true,
        activeWorkers: this.videoState.children.size,
        timeoutMs: this.videoTimeoutMs,
        activeTasks: this.videoState.activeTasks,
        maxConcurrent: this.videoState.maxConcurrent,
        crashCountLastHour: this.countRecentEvents(
          this.videoState,
          'crashEvents'
        ),
        restartCountLastHour: this.countRecentEvents(
          this.videoState,
          'restartEvents'
        ),
        manualRestartCount: this.videoState.manualRestartCount,
        totalRuns: this.videoState.totalRuns,
        totalFailures: this.videoState.totalFailures,
        totalTimeouts: this.videoState.totalTimeouts,
        lastCrashAt: this.videoState.lastCrashAt,
        lastRestartAt: this.videoState.lastRestartAt,
        lastStartedAt: this.videoState.lastStartedAt,
        lastFinishedAt: this.videoState.lastFinishedAt,
        lastError: this.videoState.lastError,
      },
      logCount: this.logs.length,
    };
  }

  attachChild(state, child, workerName) {
    const restartMode = state.restartMode;
    state.child = child;
    state.pid = child.pid ?? null;
    state.status = 'idle';
    state.lastStartedAt = new Date().toISOString();
    state.lastError = null;
    state.nextRestartAt = null;

    if (restartMode) {
      state.lastRestartAt = new Date().toISOString();
      this.pushRecentEvent(state, 'restartEvents');
      this.recordLifecycleEvent(
        'sandbox-worker-restart',
        workerName,
        {
          pid: state.pid,
          mode: restartMode,
          lastCrashAt: state.lastCrashAt ?? null,
        },
        `${workerName} sandbox worker restarted.`
      );
      state.restartMode = null;
    } else {
      this.recordLog({
        kind: `${workerName}-worker-started`,
        worker: workerName,
        pid: state.pid,
        summary: `${workerName} sandbox worker started.`,
      });
    }

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'response') {
        const pending = state.pending.get(message.requestId);

        if (!pending) {
          return;
        }

        state.pending.delete(message.requestId);
        clearTimeout(pending.timerId);

        if (message.ok) {
          pending.resolve(message.result ?? null);
          return;
        }

        const error = new Error(
          message.error?.message ?? `${workerName} sandbox worker failed.`
        );
        error.name = message.error?.name ?? 'Error';
        error.stack = message.error?.stack ?? error.stack;
        pending.reject(error);
        return;
      }

      if (message.type === 'log' && message.event) {
        this.recordLog({
          worker: workerName,
          ...message.event,
        });
      }
    });

    child.once('exit', (code, signal) => {
      const terminationReason = state.terminationReason ?? null;
      state.terminationReason = null;
      const exitError =
        code === 0 && !signal
          ? null
          : {
              code: code ?? null,
              signal: signal ?? null,
            };

      for (const pending of state.pending.values()) {
        clearTimeout(pending.timerId);
        pending.reject(
          new Error(`${workerName} sandbox worker exited before responding.`)
        );
      }

      state.pending.clear();
      state.child = null;
      state.pid = null;
      state.status = 'stopped';
      state.lastExitedAt = new Date().toISOString();
      state.lastError = exitError;

      const treatAsCrash =
        terminationReason === 'forced-crash' ||
        (terminationReason !== 'manual-restart' && Boolean(exitError));

      if (workerName === 'video' && state.taskId) {
        this.videoState.children.delete(state.taskId);
      }

      if (treatAsCrash) {
        state.lastCrashAt = new Date().toISOString();
        this.pushRecentEvent(state, 'crashEvents');
        this.recordLifecycleEvent(
          'sandbox-worker-crash',
          workerName,
          {
            reason: terminationReason ?? 'unexpected-exit',
            ...exitError,
          },
          `${workerName} sandbox worker crashed.`
        );
      }

      this.recordLog({
        kind: `${workerName}-worker-exited`,
        worker: workerName,
        summary: `${workerName} sandbox worker exited.`,
        details: exitError,
      });

      if (workerName === 'browser') {
        if (state.restartMode === 'manual-restart-immediate') {
          state.restartMode = 'manual-restart';
          this.ensureBrowserWorker().catch((error) => {
            this.browserState.lastError = serializeError(error);
          });
        } else if (treatAsCrash) {
          state.restartMode = 'auto-restart';
          this.scheduleBrowserRestart();
        }
      }
    });
  }

  scheduleBrowserRestart() {
    if (this.browserState.autoRestartScheduled) {
      return;
    }

    this.browserState.autoRestartScheduled = true;
    this.browserState.restarts += 1;
    const backoffMs = Math.min(
      15000,
      1000 * 2 ** Math.min(this.browserState.restarts, 4)
    );
    this.browserState.nextRestartAt = new Date(
      Date.now() + backoffMs
    ).toISOString();
    const timerId = setTimeout(() => {
      this.browserState.autoRestartScheduled = false;
      this.ensureBrowserWorker().catch((error) => {
        this.browserState.lastError = serializeError(error);
        this.recordLog({
          kind: 'browser-worker-restart-failed',
          worker: 'browser',
          summary: 'Browser sandbox worker restart failed.',
          details: serializeError(error),
        });
      });
    }, backoffMs);
    timerId.unref?.();
  }

  async ensureBrowserWorker() {
    if (this.browserState.child && this.browserState.child.connected) {
      return this.browserState.child;
    }

    this.browserState.status = 'starting';
    const child = fork(this.browserWorkerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        ...process.env,
        PANTHEON_SANDBOX_KIND: 'browser',
      },
    });

    this.attachChild(this.browserState, child, 'browser');
    return child;
  }

  sendRequest(state, child, workerName, action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = `${workerName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timerId = setTimeout(() => {
        state.pending.delete(requestId);
        if (workerName === 'video') {
          this.videoState.totalTimeouts += 1;
        }
        reject(
          new Error(
            `${workerName} sandbox request timed out after ${timeoutMs}ms`
          )
        );
        child.kill('SIGKILL');
      }, timeoutMs);
      timerId.unref?.();

      state.pending.set(requestId, { resolve, reject, timerId });
      child.send({
        type: 'request',
        requestId,
        action,
        payload,
      });
    });
  }

  async prewarmBrowser() {
    return this.runBrowserRequest('prewarm', {});
  }

  async restartWorker(worker) {
    const normalized = String(worker ?? '')
      .trim()
      .toLowerCase();

    if (normalized === 'browser') {
      const child = await this.ensureBrowserWorker();
      this.browserState.manualRestartCount += 1;
      this.browserState.restartMode = 'manual-restart-immediate';
      this.recordLog({
        kind: 'sandbox-worker-restart-requested',
        worker: 'browser',
        summary: 'Browser sandbox restart requested.',
      });
      this.browserState.terminationReason = 'manual-restart';
      child.kill('SIGTERM');
      await this.ensureBrowserWorker();
      return this.getStatus().browser;
    }

    if (normalized === 'video') {
      this.videoState.manualRestartCount += 1;
      this.videoState.lastRestartAt = new Date().toISOString();
      this.pushRecentEvent(this.videoState, 'restartEvents');
      const terminatedTaskIds = [...this.videoState.children.keys()];

      for (const [taskId, entry] of this.videoState.children.entries()) {
        entry.state.terminationReason = 'manual-restart';
        entry.child.kill('SIGTERM');
        this.videoState.children.delete(taskId);
      }

      this.recordLifecycleEvent(
        'sandbox-worker-restart',
        'video',
        {
          mode: 'manual-restart',
          terminatedTaskIds,
        },
        'Video sandbox supervisor restart requested.'
      );
      return this.getStatus().video;
    }

    throw new Error(`Unsupported sandbox worker: ${worker}`);
  }

  async crashWorker(worker) {
    const normalized = String(worker ?? '')
      .trim()
      .toLowerCase();

    if (normalized === 'browser') {
      const child = await this.ensureBrowserWorker();
      this.recordLog({
        kind: 'sandbox-worker-crash-requested',
        worker: 'browser',
        summary: 'Browser sandbox crash requested.',
      });
      this.browserState.terminationReason = 'forced-crash';
      child.kill('SIGKILL');
      return {
        ok: true,
        worker: 'browser',
      };
    }

    if (normalized === 'video') {
      const first = this.videoState.children.values().next().value;

      if (!first) {
        return {
          ok: false,
          worker: 'video',
          reason: 'no-active-video-worker',
        };
      }

      first.state.terminationReason = 'forced-crash';
      first.child.kill('SIGKILL');
      return {
        ok: true,
        worker: 'video',
        taskId: first.taskId,
      };
    }

    throw new Error(`Unsupported sandbox worker: ${worker}`);
  }

  async browserSnapshot(payload = {}) {
    return this.runBrowserRequest('snapshot', payload);
  }

  async browserLogs(limit = 60) {
    const result = await this.runBrowserRequest('logs', { limit });
    return result.logs ?? [];
  }

  async runBrowserRequest(action, payload = {}) {
    const execute = async () => {
      const child = await this.ensureBrowserWorker();
      this.browserState.totalRequests += 1;
      this.browserState.status = 'running';
      this.recordLog({
        kind: 'browser-request-started',
        worker: 'browser',
        action,
        summary: `Browser sandbox started ${action}.`,
      });

      try {
        const result = await this.sendRequest(
          this.browserState,
          child,
          'browser',
          action,
          payload,
          this.browserTimeoutMs
        );
        this.browserState.status = 'idle';
        this.recordLog({
          kind: 'browser-request-completed',
          worker: 'browser',
          action,
          summary: `Browser sandbox completed ${action}.`,
        });
        return result;
      } catch (error) {
        this.browserState.status = 'failed';
        this.browserState.totalFailures += 1;
        this.browserState.lastError = serializeError(error);
        this.recordLog({
          kind: 'browser-request-failed',
          worker: 'browser',
          action,
          summary: `Browser sandbox failed ${action}.`,
          details: serializeError(error),
        });
        throw error;
      }
    };

    const queued = this.browserQueue.then(execute, execute);
    this.browserQueue = queued.catch(() => null);
    return queued;
  }

  async runVideoTask(payload = {}) {
    if (this.videoState.activeTasks >= this.videoState.maxConcurrent) {
      const error = new Error(
        `Video sandbox concurrency limit reached (${this.videoState.maxConcurrent}).`
      );
      error.statusCode = 429;
      this.videoState.totalFailures += 1;
      this.videoState.lastError = serializeError(error);
      throw error;
    }

    this.videoState.activeTasks += 1;
    this.videoState.totalRuns += 1;
    this.videoState.lastStartedAt = new Date().toISOString();
    this.recordLog({
      kind: 'video-task-started',
      worker: 'video',
      summary: 'Video sandbox task started.',
    });

    const taskId = `video-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const state = {
      kind: 'video',
      taskId,
      pending: new Map(),
    };
    const child = fork(this.videoWorkerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        ...process.env,
        PANTHEON_SANDBOX_KIND: 'video',
      },
    });

    this.attachChild(state, child, 'video');
    this.videoState.children.set(taskId, {
      taskId,
      child,
      state,
    });

    try {
      const result = await this.sendRequest(
        state,
        child,
        'video',
        'generate-video',
        payload,
        this.videoTimeoutMs
      );
      this.recordLog({
        kind: 'video-task-completed',
        worker: 'video',
        summary: 'Video sandbox task completed.',
      });
      child.disconnect?.();
      child.kill();
      return result;
    } catch (error) {
      this.videoState.totalFailures += 1;
      this.videoState.lastError = serializeError(error);
      this.recordLog({
        kind: 'video-task-failed',
        worker: 'video',
        summary: 'Video sandbox task failed.',
        details: serializeError(error),
      });
      throw error;
    } finally {
      this.videoState.activeTasks = Math.max(
        0,
        this.videoState.activeTasks - 1
      );
      this.videoState.lastFinishedAt = new Date().toISOString();
    }
  }
}
