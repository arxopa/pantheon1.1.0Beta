function stableStringify(value) {
  return JSON.stringify(value, Object.keys(value ?? {}).sort());
}

export class ObservationContextQueue {
  constructor(options = {}) {
    this.maxItems = Math.max(10, Number(options.maxItems ?? 120));
    this.dedupeWindowMs = Math.max(50, Number(options.dedupeWindowMs ?? 500));
    this.items = [];
    this.lastSignature = null;
    this.lastSignatureAt = 0;
  }

  push(event) {
    const normalizedEvent = {
      id:
        event.id ??
        `observation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: event.createdAt ?? new Date().toISOString(),
      kind: event.kind ?? 'observation',
      source: event.source ?? 'activity-collector',
      personalityId: event.personalityId ?? 'default',
      privacy: event.privacy ?? null,
      payload: event.payload ?? null,
    };
    const signature = `${normalizedEvent.kind}:${normalizedEvent.source}:${stableStringify(
      normalizedEvent.payload ?? {}
    )}`;
    const now = Date.now();

    if (
      signature === this.lastSignature &&
      now - this.lastSignatureAt <= this.dedupeWindowMs
    ) {
      return null;
    }

    this.lastSignature = signature;
    this.lastSignatureAt = now;
    this.items = [...this.items, normalizedEvent].slice(-this.maxItems);
    return normalizedEvent;
  }

  clear() {
    this.items = [];
    this.lastSignature = null;
    this.lastSignatureAt = 0;
  }

  snapshot(limit = 40) {
    const boundedLimit = Math.max(
      1,
      Math.min(this.maxItems, Number(limit ?? 40))
    );
    return {
      total: this.items.length,
      events: this.items.slice(-boundedLimit).reverse(),
    };
  }

  getSummary() {
    const latestWindow =
      [...this.items]
        .reverse()
        .find((entry) => entry.kind === 'window-focus') ?? null;
    const latestTypingMetrics =
      [...this.items]
        .reverse()
        .find((entry) => entry.kind === 'typing-metrics') ?? null;
    const countsByKind = this.items.reduce((accumulator, entry) => {
      accumulator[entry.kind] = Number(accumulator[entry.kind] ?? 0) + 1;
      return accumulator;
    }, {});

    return {
      totalEvents: this.items.length,
      countsByKind,
      latestWindow: latestWindow?.payload ?? null,
      latestTypingMetrics: latestTypingMetrics?.payload ?? null,
    };
  }
}
