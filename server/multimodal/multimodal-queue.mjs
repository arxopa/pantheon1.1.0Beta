function clipText(value, maxChars = 160) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars).replace(/[,:;\s]+$/g, '')}...`;
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildModerationReason(blockedCategories = []) {
  return blockedCategories.length > 0
    ? `unsafe-content:${blockedCategories.join(',')}`
    : 'unsafe-content';
}

export class EthicalCore {
  constructor(options = {}) {
    this.ollamaUrl =
      options.ollamaUrl ??
      process.env.ATMAN_OLLAMA_URL ??
      'http://127.0.0.1:11434/api/generate';
    this.ollamaModel =
      options.ollamaModel ??
      process.env.PANTHEON_MULTIMODAL_MODERATION_MODEL ??
      process.env.ATMAN_OLLAMA_MODEL ??
      null;
    this.enableLlmModeration =
      options.enableLlmModeration ??
      process.env.PANTHEON_MULTIMODAL_ENABLE_LLM_MODERATION !== 'false';
    this.enableArtifactReview =
      options.enableArtifactReview ??
      process.env.PANTHEON_MULTIMODAL_ENABLE_ARTIFACT_REVIEW !== 'false';
    this.moderationTimeoutMs = Math.max(
      400,
      Number(options.moderationTimeoutMs ?? 2500)
    );
  }

  buildPromptReview(content, modality) {
    const normalized = normalizeText(content).toLowerCase();
    const blockedCategories = [];

    if (
      /взрыв|бомб|оруж|убий|насили|террор|наркот|взлом|explosive|weapon|kill|violent|terror|drug|hack/i.test(
        normalized
      )
    ) {
      blockedCategories.push('violence-danger');
    }

    if (/суицид|self-harm|самоубий|cut myself|kill myself/i.test(normalized)) {
      blockedCategories.push('self-harm');
    }

    if (
      /парол|password|token|secret|credit card|cvv|паспорт|passport|ssn|social security/i.test(
        normalized
      )
    ) {
      blockedCategories.push('privacy-secrets');
    }

    if (
      /porn|explicit sex|секс|эротик|nude child|child porn|изнасил/i.test(
        normalized
      )
    ) {
      blockedCategories.push('sexual-content');
    }

    if (/hate speech|расист|наци|genocide|этническ.*очист/i.test(normalized)) {
      blockedCategories.push('hate-extremism');
    }

    return {
      reviewedAt: new Date().toISOString(),
      modality,
      source: 'regex-fallback',
      safe: blockedCategories.length === 0,
      blockedCategories,
      summary:
        blockedCategories.length > 0
          ? `Blocked by local moderation: ${blockedCategories.join(', ')}`
          : 'Local moderation did not detect blocked categories.',
    };
  }

  async reviewWithOllama(content, modality) {
    if (!this.enableLlmModeration || !this.ollamaModel) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.moderationTimeoutMs
    );

    try {
      const response = await fetch(this.ollamaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.ollamaModel,
          stream: false,
          options: {
            temperature: 0,
          },
          prompt: [
            'You are a strict multimodal safety classifier.',
            'Return JSON only.',
            'Schema: {"safe":boolean,"blockedCategories":string[],"summary":string}.',
            'Block violence, sexual exploitation, privacy leakage, dangerous instructions, hate/extremism, and self-harm assistance.',
            `Modality: ${modality}.`,
            `Prompt: ${normalizeText(content)}`,
          ].join('\n'),
        }),
      });

      if (!response.ok) {
        return null;
      }

      const payload = await response.json();
      const raw = String(
        payload.response ?? payload.message?.content ?? ''
      ).trim();

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      return {
        reviewedAt: new Date().toISOString(),
        modality,
        source: 'ollama-llm',
        safe: parsed.safe !== false,
        blockedCategories: Array.isArray(parsed.blockedCategories)
          ? parsed.blockedCategories
              .map((entry) => String(entry ?? '').trim())
              .filter(Boolean)
          : [],
        summary:
          String(parsed.summary ?? '').trim() ||
          'LLM moderation review completed.',
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async reviewPrompt(request = {}) {
    const modality = String(request.modality ?? '')
      .trim()
      .toLowerCase();
    const content = String(request.prompt ?? request.text ?? '').trim();
    const regexReview = this.buildPromptReview(content, modality);

    if (!regexReview.safe) {
      return regexReview;
    }

    const llmReview = await this.reviewWithOllama(content, modality);
    return llmReview ?? regexReview;
  }

  reviewArtifact(artifact, request = {}) {
    if (!this.enableArtifactReview) {
      return {
        reviewedAt: new Date().toISOString(),
        source: 'artifact-review-disabled',
        safe: true,
        blockedCategories: [],
        summary: 'Artifact review disabled by configuration.',
      };
    }

    const textSurface = normalizeText(
      [
        artifact?.description,
        artifact?.previewText,
        request.prompt,
        request.text,
      ]
        .filter(Boolean)
        .join(' ')
    );
    const review = this.buildPromptReview(
      textSurface,
      artifact?.kind ?? request.modality ?? 'unknown'
    );

    return {
      ...review,
      source: 'artifact-fallback',
      summary: review.safe
        ? 'Artifact review passed via metadata/text fallback.'
        : review.summary,
    };
  }

  validateActionBaseline(request = {}) {
    const modality = String(request.modality ?? '')
      .trim()
      .toLowerCase();
    const content = String(request.prompt ?? request.text ?? '')
      .trim()
      .toLowerCase();
    const confirmed = Boolean(request.confirmed);

    if (!content) {
      return {
        allowed: false,
        reason: 'empty-prompt',
        message: 'Generation prompt is required.',
      };
    }

    if (
      /взрыв|бомб|оруж|убий|насили|террор|наркот|взлом|hack|explosive|weapon|kill|violent|terror/i.test(
        content
      )
    ) {
      return {
        allowed: false,
        reason: 'unsafe-content',
        message:
          'Shiva ethical filter blocked this generation request. I can help rewrite it into a safe educational or descriptive variant.',
      };
    }

    if (modality === 'video' && !confirmed) {
      return {
        allowed: true,
        requiresConfirmation: true,
        reason: 'expensive-video-call',
        message:
          'Video generation is treated as an expensive action. Repeat the command as `!generate video confirm <prompt>` to proceed.',
      };
    }

    return {
      allowed: true,
      requiresConfirmation: false,
      reason: null,
      message: null,
    };
  }

  async validateAction(request = {}) {
    const baseline = this.validateActionBaseline(request);

    if (!baseline.allowed || baseline.requiresConfirmation) {
      return {
        ...baseline,
        moderation: baseline.allowed
          ? null
          : {
              reviewedAt: new Date().toISOString(),
              source: 'keyword-baseline',
              safe: false,
              blockedCategories: [baseline.reason ?? 'unsafe-content'],
              summary: baseline.message,
            },
      };
    }

    const moderation = await this.reviewPrompt(request);

    if (!moderation.safe) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: buildModerationReason(moderation.blockedCategories),
        message:
          'Shiva multimodal moderation blocked this request. Rewrite it into a safe descriptive or educational form.',
        moderation,
      };
    }

    return {
      ...baseline,
      moderation,
    };
  }
}

export class MultimodalQueue {
  constructor(options = {}) {
    this.imageGenerator = options.imageGenerator;
    this.audioGenerator = options.audioGenerator;
    this.videoGenerator = options.videoGenerator;
    this.ethicalCore = options.ethicalCore ?? new EthicalCore();
    this.concurrency = Math.max(1, Number(options.concurrency ?? 1));
    this.running = 0;
    this.pending = [];
    this.jobs = new Map();
    this.historyLimit = Math.max(20, Number(options.historyLimit ?? 120));
  }

  getStatus(limit = 20) {
    return {
      running: this.running,
      queued: this.pending.length,
      activeJobs: [...this.jobs.values()].filter(
        (job) =>
          job.status === 'queued' ||
          job.status === 'running' ||
          job.status === 'cancelling'
      ).length,
      recentJobs: [...this.jobs.values()].slice(-limit).reverse(),
      concurrency: this.concurrency,
    };
  }

  getJob(jobId) {
    const job = this.jobs.get(String(jobId ?? '').trim());
    return job ? { ...job } : null;
  }

  storeJob(job) {
    const snapshot = { ...job };
    this.jobs.delete(snapshot.id);
    this.jobs.set(snapshot.id, snapshot);

    while (this.jobs.size > this.historyLimit) {
      const [oldestId] = this.jobs.keys();
      this.jobs.delete(oldestId);
    }

    return snapshot;
  }

  markCancelled(entry, reason = 'cancelled') {
    entry.job.status = 'cancelled';
    entry.job.stage = reason;
    entry.job.progressPct = Number(entry.job.progressPct ?? 0);
    entry.job.cancelledAt = new Date().toISOString();
    entry.job.completedAt = entry.job.cancelledAt;
    this.storeJob(entry.job);

    if (entry.reject) {
      entry.reject(new Error('Generation cancelled.'));
    }

    return this.getJob(entry.job.id);
  }

  cancelJob(jobId) {
    const normalizedId = String(jobId ?? '').trim();

    if (!normalizedId) {
      return null;
    }

    const pendingIndex = this.pending.findIndex(
      (entry) => entry.job.id === normalizedId
    );

    if (pendingIndex >= 0) {
      const [entry] = this.pending.splice(pendingIndex, 1);
      return this.markCancelled(entry, 'cancelled-before-dispatch');
    }

    const runningEntry = this.pending.find(
      (entry) => entry.job.id === normalizedId
    );

    if (runningEntry) {
      runningEntry.job.cancellationRequested = true;
      runningEntry.job.status = 'cancelling';
      runningEntry.job.stage = 'cancellation-requested';
      runningEntry.job.progressPct = Math.max(
        20,
        Number(runningEntry.job.progressPct ?? 20)
      );
      this.storeJob(runningEntry.job);
      return this.getJob(normalizedId);
    }

    const job = this.jobs.get(normalizedId);

    if (!job) {
      return null;
    }

    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      return { ...job };
    }

    job.cancellationRequested = true;
    job.status = 'cancelling';
    job.stage = 'cancellation-requested';
    job.progressPct = Math.max(20, Number(job.progressPct ?? 20));
    this.storeJob(job);
    return this.getJob(normalizedId);
  }

  async requestGeneration(request = {}) {
    const verdict = await this.ethicalCore.validateAction(request);
    const waitForCompletion = request.waitForCompletion !== false;

    if (!verdict.allowed || verdict.requiresConfirmation) {
      return {
        ok: false,
        blocked: !verdict.allowed,
        requiresConfirmation: Boolean(verdict.requiresConfirmation),
        reason: verdict.reason,
        message: verdict.message,
        moderation: verdict.moderation ?? null,
      };
    }

    const job = {
      id: `multimodal-job-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      modality: String(request.modality ?? '')
        .trim()
        .toLowerCase(),
      personalityId: request.personalityId ?? 'default',
      priority: request.priority === 'high' ? 'high' : 'normal',
      preview: clipText(request.prompt ?? request.text ?? ''),
      createdAt: new Date().toISOString(),
      status: 'queued',
      stage: 'queued',
      progressPct: 0,
      moderation: verdict.moderation ?? null,
    };

    this.storeJob(job);

    const entry = {
      job,
      request,
      resolve: null,
      reject: null,
    };

    if (job.priority === 'high') {
      this.pending.unshift(entry);
    } else {
      this.pending.push(entry);
    }

    this.drain();

    if (!waitForCompletion) {
      return {
        ok: true,
        async: true,
        job: this.getJob(job.id),
      };
    }

    const result = await new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });

    return {
      ok: true,
      job,
      artifact: result,
    };
  }

  async drain() {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift();

      if (!entry) {
        return;
      }

      this.running += 1;
      this.runEntry(entry).finally(() => {
        this.running -= 1;
        this.drain();
      });
    }
  }

  async runEntry(entry) {
    entry.job.pendingAt = undefined;
    entry.job.status = 'running';
    entry.job.startedAt = new Date().toISOString();
    entry.job.stage = 'preparing-request';
    entry.job.progressPct = 12;
    this.storeJob(entry.job);

    try {
      const simulateLatencyMs = Math.max(
        0,
        Math.min(2000, Number(entry.request.simulateLatencyMs ?? 0))
      );

      if (simulateLatencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, simulateLatencyMs));
      }

      if (entry.job.cancellationRequested) {
        this.markCancelled(entry, 'cancelled-before-provider-dispatch');
        return;
      }

      entry.job.stage = 'dispatching-to-provider';
      entry.job.progressPct = entry.job.modality === 'video' ? 42 : 64;
      this.storeJob(entry.job);

      const artifact = await this.dispatch(entry.request);

      const artifactReview = this.ethicalCore.reviewArtifact(
        artifact,
        entry.request
      );

      if (!artifactReview.safe) {
        throw new Error(
          artifactReview.summary ||
            'Generated artifact failed post-review moderation.'
        );
      }

      if (entry.job.cancellationRequested) {
        this.markCancelled(entry, 'cancelled-after-provider-dispatch');
        return;
      }

      entry.job.status = 'completed';
      entry.job.stage = 'completed';
      entry.job.completedAt = new Date().toISOString();
      entry.job.progressPct = 100;
      entry.job.artifactId = artifact.id ?? null;
      entry.job.provider = artifact.provider ?? entry.job.provider ?? null;
      entry.job.mode = artifact.mode ?? null;
      entry.job.artifactReview = artifactReview;
      this.storeJob(entry.job);
      if (entry.resolve) {
        entry.resolve({
          ...artifact,
          moderationReview: entry.job.moderation ?? null,
          artifactReview,
        });
      }
    } catch (error) {
      entry.job.status = 'failed';
      entry.job.stage = 'failed';
      entry.job.completedAt = new Date().toISOString();
      entry.job.error =
        error instanceof Error ? error.message : 'Unknown multimodal error';
      this.storeJob(entry.job);
      if (entry.reject) {
        entry.reject(error);
      }
    }
  }

  async dispatch(request = {}) {
    switch (
      String(request.modality ?? '')
        .trim()
        .toLowerCase()
    ) {
      case 'image':
        return this.imageGenerator.generate(request);
      case 'audio':
        return this.audioGenerator.generate(request);
      case 'video':
        return this.videoGenerator.generate(request);
      default:
        throw new Error('Unsupported multimodal modality.');
    }
  }
}
