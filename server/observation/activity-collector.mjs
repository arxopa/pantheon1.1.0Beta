export class ActivityCollector {
  constructor(options = {}) {
    this.queue = options.queue;
    this.getState = options.getState ?? (() => ({}));
    this.minIntervalMs = Math.max(0, Number(options.minIntervalMs ?? 500));
    this.lastCaptureAt = new Map();
  }

  isScopeEnabled(scope) {
    return Boolean(this.getState()?.consent?.[scope]);
  }

  canCapture(scope, personalityId = 'default') {
    if (this.minIntervalMs <= 0) {
      return true;
    }

    const key = `${personalityId}:${scope}`;
    const now = Date.now();
    const previous = this.lastCaptureAt.get(key) ?? 0;

    if (now - previous < this.minIntervalMs) {
      return false;
    }

    this.lastCaptureAt.set(key, now);
    return true;
  }

  captureWindowFocus(payload = {}) {
    if (!this.isScopeEnabled('windows')) {
      return null;
    }

    if (!this.canCapture('windows', payload.personalityId ?? 'default')) {
      return null;
    }

    return this.queue.push({
      kind: 'window-focus',
      source: 'activity-collector',
      personalityId: payload.personalityId ?? 'default',
      privacy: {
        rawRetained: false,
        contentIncluded: false,
        consentScope: 'windows',
      },
      payload: {
        app: payload.app ?? 'Pantheon',
        title: payload.title ?? 'Observation sample',
        durationMs: Number(payload.durationMs ?? 0),
      },
    });
  }

  captureTypingMetrics(payload = {}) {
    if (!this.isScopeEnabled('typingMetrics')) {
      return null;
    }

    if (!this.canCapture('typingMetrics', payload.personalityId ?? 'default')) {
      return null;
    }

    return this.queue.push({
      kind: 'typing-metrics',
      source: 'activity-collector',
      personalityId: payload.personalityId ?? 'default',
      privacy: {
        rawRetained: false,
        contentIncluded: false,
        consentScope: 'typingMetrics',
      },
      payload: {
        app: payload.app ?? 'Pantheon',
        burstLength: Number(payload.burstLength ?? 0),
        idleMs: Number(payload.idleMs ?? 0),
        correctionRate: Number(payload.correctionRate ?? 0),
      },
    });
  }

  captureSample(payload = {}) {
    const captured = [];
    const windowEvent = this.captureWindowFocus(payload.window ?? payload);
    const typingEvent = this.captureTypingMetrics(payload.typing ?? payload);

    if (windowEvent) {
      captured.push(windowEvent);
    }

    if (typingEvent) {
      captured.push(typingEvent);
    }

    return captured;
  }
}
