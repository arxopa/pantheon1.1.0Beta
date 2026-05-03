const observationScopes = [
  'windows',
  'typingMetrics',
  'audio',
  'screen',
  'keystrokes',
];

function buildSensorCapability(options = {}) {
  return {
    available: options.available !== false,
    implemented: options.implemented !== false,
    requiresConsent: options.requiresConsent !== false,
    contentMode: options.contentMode ?? 'metadata-only',
    reason: options.reason ?? null,
  };
}

export function listObservationScopes() {
  return [...observationScopes];
}

export function createObservationCapabilities(platform = process.platform) {
  return {
    platform,
    sensors: {
      windows: buildSensorCapability(),
      typingMetrics: buildSensorCapability(),
      audio: buildSensorCapability({
        available: false,
        implemented: false,
        contentMode: 'voice-activity-only',
        reason:
          'Audio capture is gated behind a later multimodal phase and explicit device permission.',
      }),
      screen: buildSensorCapability({
        available: false,
        implemented: false,
        contentMode: 'downsampled-frame',
        reason:
          'Screen capture is gated behind a later multimodal phase and OS privacy permissions.',
      }),
      keystrokes: buildSensorCapability({
        available: false,
        implemented: false,
        contentMode: 'metrics-only',
        reason:
          'Raw keystrokes are disabled by default and require a later explicit opt-in path.',
      }),
    },
  };
}

export function createObservationState() {
  return {
    enabled: false,
    sessionId: null,
    consent: {
      windows: false,
      typingMetrics: false,
      audio: false,
      screen: false,
      keystrokes: false,
    },
    lastEnabledAt: null,
    lastDisabledAt: null,
    lastConsentChangeAt: null,
    lastReportAt: null,
    lastQuestionAt: null,
    lastSampleAt: null,
  };
}

export function getActiveObservationScopes(state = {}) {
  const consent = state.consent ?? {};
  return observationScopes.filter((scope) => consent[scope]);
}

export function updateObservationState(currentState, payload = {}) {
  const next = {
    ...createObservationState(),
    ...(currentState ?? {}),
    consent: {
      ...createObservationState().consent,
      ...(currentState?.consent ?? {}),
    },
  };
  const action = String(payload.action ?? '')
    .trim()
    .toLowerCase();
  const scope = String(payload.scope ?? '').trim();
  const nowIso = new Date().toISOString();
  const changes = [];

  if (action === 'start' || action === 'on') {
    next.enabled = true;
    next.sessionId = next.sessionId ?? `observe-${Date.now().toString(36)}`;
    next.consent.windows = true;
    next.consent.typingMetrics = true;
    next.lastEnabledAt = nowIso;
    next.lastConsentChangeAt = nowIso;
    changes.push('observation-started');
  }

  if (action === 'stop' || action === 'off') {
    next.enabled = false;
    next.consent = { ...createObservationState().consent };
    next.lastDisabledAt = nowIso;
    next.lastConsentChangeAt = nowIso;
    changes.push('observation-stopped');
  }

  if ((action === 'enable-scope' || action === 'scope-on') && scope) {
    if (!(scope in next.consent)) {
      throw new Error(`Unknown observation scope: ${scope}`);
    }

    next.enabled = true;
    next.sessionId = next.sessionId ?? `observe-${Date.now().toString(36)}`;
    next.consent[scope] = true;
    next.lastConsentChangeAt = nowIso;
    changes.push(`scope-enabled:${scope}`);
  }

  if ((action === 'disable-scope' || action === 'scope-off') && scope) {
    if (!(scope in next.consent)) {
      throw new Error(`Unknown observation scope: ${scope}`);
    }

    next.consent[scope] = false;
    next.enabled = getActiveObservationScopes(next).length > 0;
    next.lastConsentChangeAt = nowIso;
    changes.push(`scope-disabled:${scope}`);
  }

  return {
    state: next,
    changes,
  };
}

export function buildObservationStatus(state = {}, queue, options = {}) {
  const capabilities = options.capabilities ?? createObservationCapabilities();
  const queueSnapshot = queue?.snapshot?.() ?? { total: 0, events: [] };
  const queueSummary = queue?.getSummary?.() ?? {
    totalEvents: queueSnapshot.total,
  };
  const activeScopes = getActiveObservationScopes(state);
  const enabled = Boolean(state.enabled);

  return {
    active: enabled && activeScopes.length > 0,
    enabled,
    sessionId: state.sessionId ?? null,
    activeScopes,
    consent: {
      ...createObservationState().consent,
      ...(state.consent ?? {}),
    },
    capabilities,
    retention: {
      rawArtifactsStored: false,
      aggregatesPersisted: true,
      queueBoundedInMemory: true,
    },
    queue: {
      total: queueSnapshot.total,
      summary: queueSummary,
    },
    lastEnabledAt: state.lastEnabledAt ?? null,
    lastDisabledAt: state.lastDisabledAt ?? null,
    lastConsentChangeAt: state.lastConsentChangeAt ?? null,
    lastReportAt: state.lastReportAt ?? null,
    lastQuestionAt: state.lastQuestionAt ?? null,
    lastSampleAt: state.lastSampleAt ?? null,
  };
}

export function buildObservationDataSnapshot(state = {}, queue, options = {}) {
  const status = buildObservationStatus(state, queue, options);
  const data = queue?.snapshot?.() ?? { total: 0, events: [] };

  return {
    ...status,
    total: data.total,
    events: data.events,
    data,
  };
}
