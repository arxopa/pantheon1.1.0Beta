function normalizeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value ?? 0)));
}

function deriveTopic(message = '', fallback = 'общее обсуждение') {
  const trimmed = String(message ?? '').trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed.split(/\s+/).slice(0, 6).join(' ');
}

function inferValence(message = '', explicitValence = null) {
  if (explicitValence != null && !Number.isNaN(Number(explicitValence))) {
    return Math.max(-1, Math.min(1, Number(explicitValence)));
  }

  const normalized = String(message ?? '').toLowerCase();
  let score = 0;

  if (
    /спасибо|молодец|хорошо|отлично|поддерж|нравит|ценю|помог/i.test(normalized)
  ) {
    score += 0.35;
  }

  if (/спор|ошибк|неправ|раздраж|злю|конфликт|критику/i.test(normalized)) {
    score -= 0.32;
  }

  if (/!/.test(normalized)) {
    score += score >= 0 ? 0.06 : -0.06;
  }

  return Math.max(-1, Math.min(1, Number(score.toFixed(2))));
}

function inferIntensity(message = '', explicitIntensity = null) {
  if (explicitIntensity != null && !Number.isNaN(Number(explicitIntensity))) {
    return clamp(explicitIntensity, 0.1, 1);
  }

  const normalized = String(message ?? '').trim();
  const lengthFactor = clamp(normalized.length / 220, 0, 0.45);
  const punctuationFactor = /!|\?/.test(normalized) ? 0.12 : 0;
  return clamp(0.32 + lengthFactor + punctuationFactor, 0.18, 0.9);
}

function buildTransientEmotion(emotion = {}, valence = 0, intensity = 0.5) {
  const baseIntensity = Number(emotion.intensity ?? 0.5);
  const baseVolatility = Number(emotion.volatility ?? 0.2);
  const type =
    valence >= 0.25
      ? 'engaged'
      : valence <= -0.2
        ? 'guarded'
        : String(emotion.type ?? 'neutral');

  return {
    type,
    intensity: clamp(
      baseIntensity * 0.7 + intensity * 0.3 + Math.abs(valence) * 0.12
    ),
    volatility: clamp(baseVolatility + (valence < 0 ? 0.12 : 0.04)),
    updatedAt: new Date().toISOString(),
  };
}

function summarizeFacts(facts = []) {
  if (!Array.isArray(facts) || facts.length === 0) {
    return 'Общих фактов пока нет.';
  }

  return facts
    .slice(-4)
    .map((fact) => `${fact.key}: ${fact.value}`)
    .join(' | ');
}

function buildSocialPrompt({ source, topic, message, sharedContext }) {
  return [
    'Это внутренний социальный канал Пантеона.',
    `Тебе пишет личность ${source.displayName}.`,
    `Текущая тема канала: ${topic}.`,
    `Общий контекст: ${summarizeFacts(sharedContext?.facts ?? [])}`,
    `Сообщение: ${message}`,
    'Ответь коротко, как самостоятельная личность. Не описывай систему и не уходи в мета-объяснения.',
  ].join(' ');
}

function inferDominanceDelta(message = '', explicitIntensity = null) {
  const normalized = String(message ?? '').toLowerCase();
  const intensity = inferIntensity(message, explicitIntensity);
  const commandingTone =
    /должен|немедл|сделай|перестань|без лишних слов|точнее/i.test(normalized);
  return commandingTone ? Number((0.06 + intensity * 0.08).toFixed(3)) : 0;
}

function inferRelationshipDelta(message = '', valence = 0, intensity = 0.5) {
  const direction = Math.sign(valence);
  const trustBase = Number((Math.abs(valence) * intensity * 0.12).toFixed(3));
  const affectionBase = Number(
    (Math.abs(valence) * intensity * 0.18).toFixed(3)
  );
  const dominance = inferDominanceDelta(message, intensity);

  return {
    trust: direction === 0 ? 0 : Number((trustBase * direction).toFixed(3)),
    affection:
      direction === 0 ? 0 : Number((affectionBase * direction).toFixed(3)),
    dominance,
  };
}

function findActiveConflict(channel, sourceId, targetId) {
  return (
    channel?.conflicts?.find(
      (entry) =>
        entry.active &&
        ((entry.initiatorId === sourceId && entry.targetId === targetId) ||
          (entry.initiatorId === targetId && entry.targetId === sourceId))
    ) ?? null
  );
}

function findCoalitionForMember(channel, personalityId) {
  return (
    channel?.coalitions?.find(
      (entry) =>
        entry.active !== false && entry.members?.includes(personalityId)
    ) ?? null
  );
}

class SocialChannelError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'SocialChannelError';
    this.statusCode = statusCode;
  }
}

export class SocialChannel {
  constructor(options = {}) {
    this.personalityManager = options.personalityManager;
    this.sharedContext = options.sharedContext;
    this.relationshipMatrix = options.relationshipMatrix ?? null;
    this.learningLedger = options.learningLedger;
    this.maxMessagesPerWindow = Number(options.maxMessagesPerWindow ?? 6);
    this.rateLimitWindowMs = Number(options.rateLimitWindowMs ?? 60000);
    this.queueTail = Promise.resolve();
    this.rateLimitBuckets = new Map();
  }

  consumeRateLimit(sourceId, targetId) {
    const key = [normalizeId(sourceId), normalizeId(targetId)]
      .sort()
      .join('::');
    const now = Date.now();
    const recent = (this.rateLimitBuckets.get(key) ?? []).filter(
      (timestamp) => now - timestamp < this.rateLimitWindowMs
    );

    if (recent.length >= this.maxMessagesPerWindow) {
      const retryAfterMs = Math.max(
        1,
        this.rateLimitWindowMs - (now - recent[0])
      );
      this.rateLimitBuckets.set(key, recent);
      throw new SocialChannelError(
        429,
        `Social message rate limit exceeded for ${sourceId} <-> ${targetId}. Retry after ${retryAfterMs}ms.`
      );
    }

    recent.push(now);
    this.rateLimitBuckets.set(key, recent);
  }

  resolveTargets(payload = {}, sourceId) {
    const explicitTargets = [
      payload.targetPersonalityId,
      payload.to,
      payload.toPersonalityId,
      ...(Array.isArray(payload.targetPersonalityIds)
        ? payload.targetPersonalityIds
        : []),
      ...(Array.isArray(payload.toPersonalityIds)
        ? payload.toPersonalityIds
        : []),
      ...(Array.isArray(payload.to) ? payload.to : []),
    ]
      .map((entry) => normalizeId(entry))
      .filter(Boolean)
      .filter((entry) => entry !== sourceId);

    if (explicitTargets.length > 0) {
      return [...new Set(explicitTargets)];
    }

    const channel = payload.channelId
      ? this.sharedContext.getChannel(payload.channelId)
      : null;

    if (channel) {
      const coalition = findCoalitionForMember(channel, sourceId);
      const eligibleMembers = coalition
        ? channel.members.filter(
            (entry) => entry !== sourceId && coalition.members.includes(entry)
          )
        : channel.members.filter((entry) => entry !== sourceId);
      return eligibleMembers;
    }

    throw new SocialChannelError(
      400,
      'Social talk requires targetPersonalityId, targetPersonalityIds, or an existing channelId.'
    );
  }

  async talk(payload = {}) {
    const sourcePersonalityId = normalizeId(
      payload.sourcePersonalityId ??
        payload.personalityId ??
        payload.from ??
        'default'
    );
    const message = String(payload.message ?? '').trim();

    if (!message) {
      throw new SocialChannelError(
        400,
        'Social talk requires a non-empty message.'
      );
    }

    const source = this.personalityManager.getPersonality(sourcePersonalityId);
    const targetPersonalityIds = this.resolveTargets(
      payload,
      sourcePersonalityId
    );

    if (targetPersonalityIds.length === 0) {
      throw new SocialChannelError(
        400,
        'Social talk requires at least one target personality.'
      );
    }

    const topic = String(payload.topic ?? '').trim() || deriveTopic(message);
    const valence = inferValence(message, payload.valence ?? null);
    const intensity = inferIntensity(message, payload.intensity ?? null);
    const members = [sourcePersonalityId, ...targetPersonalityIds];
    const facts = [
      {
        key: 'current_topic',
        value: topic,
        confidence: 0.78,
        authorId: sourcePersonalityId,
        source: 'social-talk',
      },
      ...(Array.isArray(payload.facts) ? payload.facts : []),
    ];
    const job = {
      id: `social-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      queuedAt: new Date().toISOString(),
      sourcePersonalityId,
      targetPersonalityIds,
      topic,
    };

    const run = async () => {
      let channel = await this.sharedContext.upsertChannel({
        channelId: payload.channelId,
        members,
        topic,
        metadata: {
          mode: 'social-channel',
          createdBy: sourcePersonalityId,
        },
      });
      channel = await this.sharedContext.mergeFacts(channel.id, facts, {
        authorId: sourcePersonalityId,
        source: 'social-talk',
        topic,
      });
      await this.learningLedger.recordSharedContextEvent({
        channelId: channel.id,
        kind: 'social-talk-context-sync',
        actorId: sourcePersonalityId,
        topic,
        factCount: facts.length,
      });
      channel = await this.sharedContext.appendMessage(channel.id, {
        authorId: sourcePersonalityId,
        role: 'initiator',
        text: message,
      });
      const deliveries = [];
      const relationshipDelta = inferRelationshipDelta(
        message,
        valence,
        intensity
      );

      for (const targetPersonalityId of targetPersonalityIds) {
        const activeConflict = findActiveConflict(
          channel,
          sourcePersonalityId,
          targetPersonalityId
        );

        if (activeConflict) {
          throw new SocialChannelError(
            409,
            `Social message blocked by active conflict between ${sourcePersonalityId} and ${targetPersonalityId}.`
          );
        }

        this.consumeRateLimit(sourcePersonalityId, targetPersonalityId);
        const target =
          this.personalityManager.getPersonality(targetPersonalityId);
        const activeAtman =
          await this.personalityManager.getAtman(targetPersonalityId);
        const personalityProfile =
          this.personalityManager.getPersonalityPromptProfile(
            targetPersonalityId,
            { counterpartId: sourcePersonalityId }
          );
        const reply = await activeAtman.generateResponse({
          message: buildSocialPrompt({
            source,
            topic,
            message,
            sharedContext: channel,
          }),
          userId: `social-channel:${channel.id}:${sourcePersonalityId}:${targetPersonalityId}`,
          personalityId: targetPersonalityId,
          personalityProfile: {
            ...personalityProfile,
            emotion: buildTransientEmotion(
              personalityProfile.emotion,
              valence,
              intensity
            ),
          },
        });
        const exchange = await this.personalityManager.simulateSocialExchange({
          initiatorId: sourcePersonalityId,
          responderId: targetPersonalityId,
          topic,
          intensity,
          valence,
        });
        channel = await this.sharedContext.appendMessage(channel.id, {
          authorId: targetPersonalityId,
          role: 'responder',
          targetId: sourcePersonalityId,
          text: reply.replyText,
        });
        await this.learningLedger.recordSocialExchange({
          channelId: channel.id,
          sourcePersonalityId,
          targetPersonalityId,
          topic,
          valence,
          intensity,
          message,
          response: reply.replyText,
          sourceEmotion: exchange.initiator?.emotion ?? null,
          targetEmotion: exchange.responder?.emotion ?? target.emotion ?? null,
          relationshipDelta,
        });
        if (this.relationshipMatrix) {
          await this.relationshipMatrix.update(
            sourcePersonalityId,
            targetPersonalityId,
            relationshipDelta
          );
          await this.relationshipMatrix.update(
            targetPersonalityId,
            sourcePersonalityId,
            {
              trust: Number((relationshipDelta.trust * 0.4).toFixed(3)),
              affection: Number(
                (relationshipDelta.affection * 0.35).toFixed(3)
              ),
              dominance: Number(
                (relationshipDelta.dominance * -0.25).toFixed(3)
              ),
            }
          );
        }
        const relationship = this.relationshipMatrix?.get(
          sourcePersonalityId,
          targetPersonalityId
        );
        deliveries.push({
          targetPersonalityId,
          response: reply.replyText,
          emotion: exchange.responder?.emotion ?? target.emotion ?? null,
          communicationProtocol: exchange.communicationProtocol ?? null,
          relationship,
        });
      }

      return {
        ok: true,
        job: {
          ...job,
          startedAt: job.queuedAt,
          completedAt: new Date().toISOString(),
        },
        channel,
        topic,
        sourcePersonalityId,
        targetPersonalityIds,
        deliveries,
        transcript: channel.recentMessages ?? [],
        sourcePersonality:
          this.personalityManager.getPersonality(sourcePersonalityId),
        relationships: targetPersonalityIds
          .map((targetPersonalityId) =>
            this.relationshipMatrix?.get(
              sourcePersonalityId,
              targetPersonalityId
            )
          )
          .filter(Boolean),
        socialMap: this.personalityManager.getSocialMap(),
      };
    };

    const scheduled = this.queueTail.then(run);
    this.queueTail = scheduled.catch(() => undefined);
    return scheduled;
  }
}
