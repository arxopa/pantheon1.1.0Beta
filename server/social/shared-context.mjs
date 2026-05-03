import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSharedContextPath = path.join(
  __dirname,
  'data',
  'shared-context.json'
);

function createInitialState() {
  return {
    lastUpdatedAt: null,
    channels: [],
  };
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value ?? 0)));
}

function normalizeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}

function uniqueIds(values = []) {
  return [
    ...new Set(values.map((value) => normalizeId(value)).filter(Boolean)),
  ];
}

function normalizeFact(
  fact = {},
  fallbackAuthorId = null,
  fallbackSource = 'social'
) {
  return {
    key: String(fact.key ?? '').trim(),
    value: String(fact.value ?? '').trim(),
    confidence: Number(fact.confidence ?? 0.7),
    authorId: fact.authorId ? normalizeId(fact.authorId) : fallbackAuthorId,
    source: String(fact.source ?? fallbackSource).trim() || fallbackSource,
    createdAt: fact.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeMessage(message = {}) {
  return {
    id:
      message.id ??
      `shared-message-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: message.createdAt ?? new Date().toISOString(),
    authorId: normalizeId(message.authorId),
    role: String(message.role ?? 'message').trim() || 'message',
    text: String(message.text ?? '').trim(),
    targetId: message.targetId ? normalizeId(message.targetId) : null,
  };
}

function normalizeCoalition(coalition = {}) {
  const members = uniqueIds(coalition.members ?? []);
  const name = String(coalition.name ?? coalition.id ?? 'coalition').trim();

  return {
    id: normalizeId(coalition.id ?? name),
    name,
    createdAt: coalition.createdAt ?? new Date().toISOString(),
    updatedAt: coalition.updatedAt ?? new Date().toISOString(),
    goal: String(coalition.goal ?? '').trim() || null,
    leaderId: normalizeId(coalition.leaderId ?? members[0] ?? null) || null,
    members,
    strength: clamp(coalition.strength ?? 0.6),
    active: coalition.active !== false,
  };
}

function normalizeConflict(conflict = {}) {
  return {
    id:
      normalizeId(conflict.id) ||
      `conflict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: conflict.createdAt ?? new Date().toISOString(),
    updatedAt: conflict.updatedAt ?? new Date().toISOString(),
    initiatorId: normalizeId(conflict.initiatorId),
    targetId: normalizeId(conflict.targetId),
    reason: String(conflict.reason ?? '').trim() || null,
    active: conflict.active !== false,
    resolvedAt: conflict.resolvedAt ?? null,
    resolverId: normalizeId(conflict.resolverId ?? null) || null,
  };
}

function normalizeChannel(channel = {}) {
  return {
    id: normalizeId(channel.id),
    createdAt: channel.createdAt ?? new Date().toISOString(),
    updatedAt: channel.updatedAt ?? new Date().toISOString(),
    topic: channel.topic ? String(channel.topic).trim() : null,
    members: uniqueIds(channel.members ?? []),
    facts: Array.isArray(channel.facts)
      ? channel.facts
          .map((fact) => normalizeFact(fact))
          .filter((fact) => fact.key && fact.value)
          .slice(-24)
      : [],
    recentMessages: Array.isArray(channel.recentMessages)
      ? channel.recentMessages
          .map((message) => normalizeMessage(message))
          .filter((message) => message.authorId && message.text)
          .slice(-80)
      : [],
    coalitions: Array.isArray(channel.coalitions)
      ? channel.coalitions
          .map((coalition) => normalizeCoalition(coalition))
          .filter((coalition) => coalition.id)
          .slice(-12)
      : [],
    conflicts: Array.isArray(channel.conflicts)
      ? channel.conflicts
          .map((conflict) => normalizeConflict(conflict))
          .filter(
            (conflict) =>
              conflict.id && conflict.initiatorId && conflict.targetId
          )
          .slice(-24)
      : [],
    metadata:
      typeof channel.metadata === 'object' && channel.metadata
        ? { ...channel.metadata }
        : {},
  };
}

export class SharedContextStore {
  constructor(options = {}) {
    this.filePath =
      options.filePath ??
      process.env.PANTHEON_SHARED_CONTEXT_PATH ??
      defaultSharedContextPath;
    this.maxChannels = Number(options.maxChannels ?? 40);
    this.maxFactsPerChannel = Number(options.maxFactsPerChannel ?? 24);
    this.maxMessagesPerChannel = Number(options.maxMessagesPerChannel ?? 80);
    this.state = createInitialState();
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...createInitialState(),
        ...parsed,
        channels: Array.isArray(parsed.channels)
          ? parsed.channels.map((channel) => normalizeChannel(channel))
          : [],
      };
    } catch (error) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      ) {
        throw error;
      }

      await this.flush();
    }

    return this.state;
  }

  async flush() {
    this.state.lastUpdatedAt = new Date().toISOString();
    await writeFile(
      this.filePath,
      `${JSON.stringify(this.state, null, 2)}\n`,
      'utf8'
    );
  }

  buildChannelId(members = [], channelId = null) {
    if (channelId) {
      return normalizeId(channelId);
    }

    const normalizedMembers = uniqueIds(members).sort();

    if (normalizedMembers.length === 0) {
      throw new Error('Shared context channel requires at least one member.');
    }

    return `social-${normalizedMembers.join('--')}`;
  }

  listChannels(limit = 20) {
    const boundedLimit = Math.max(
      1,
      Math.min(this.maxChannels, Number(limit ?? 20) || 20)
    );
    return {
      total: this.state.channels.length,
      channels: [...this.state.channels]
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime()
        )
        .slice(0, boundedLimit),
    };
  }

  getChannel(channelId) {
    const normalizedId = normalizeId(channelId);
    return (
      this.state.channels.find((channel) => channel.id === normalizedId) ?? null
    );
  }

  async upsertChannel(input = {}) {
    const members = uniqueIds(input.members ?? []);
    const channelId = this.buildChannelId(members, input.channelId ?? null);
    const existingIndex = this.state.channels.findIndex(
      (channel) => channel.id === channelId
    );
    const existing =
      existingIndex >= 0 ? this.state.channels[existingIndex] : null;
    const nextChannel = normalizeChannel({
      ...(existing ?? {}),
      id: channelId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      topic: input.topic ?? existing?.topic ?? null,
      members: members.length > 0 ? members : (existing?.members ?? []),
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
      facts: input.facts ?? existing?.facts ?? [],
      recentMessages: input.recentMessages ?? existing?.recentMessages ?? [],
      coalitions: input.coalitions ?? existing?.coalitions ?? [],
      conflicts: input.conflicts ?? existing?.conflicts ?? [],
    });

    if (existingIndex >= 0) {
      this.state.channels[existingIndex] = nextChannel;
    } else {
      this.state.channels = [...this.state.channels, nextChannel].slice(
        -this.maxChannels
      );
    }

    await this.flush();
    return nextChannel;
  }

  async mergeFacts(channelId, facts = [], metadata = {}) {
    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Unknown shared context channel: ${channelId}`);
    }

    const mergedFacts = [...(channel.facts ?? [])];

    for (const input of facts) {
      const fact = normalizeFact(
        input,
        normalizeId(metadata.authorId),
        metadata.source ?? 'social'
      );

      if (!fact.key || !fact.value) {
        continue;
      }

      const existingIndex = mergedFacts.findIndex(
        (entry) => entry.key === fact.key
      );

      if (existingIndex >= 0) {
        mergedFacts[existingIndex] = {
          ...mergedFacts[existingIndex],
          ...fact,
          createdAt: mergedFacts[existingIndex].createdAt,
        };
      } else {
        mergedFacts.push(fact);
      }
    }

    return this.upsertChannel({
      channelId,
      members: channel.members,
      topic: metadata.topic ?? channel.topic,
      metadata: channel.metadata,
      facts: mergedFacts.slice(-this.maxFactsPerChannel),
      recentMessages: channel.recentMessages,
      coalitions: channel.coalitions,
      conflicts: channel.conflicts,
    });
  }

  async appendMessage(channelId, message) {
    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Unknown shared context channel: ${channelId}`);
    }

    const nextMessage = normalizeMessage(message);
    return this.upsertChannel({
      channelId,
      members: channel.members,
      topic: channel.topic,
      metadata: channel.metadata,
      facts: channel.facts,
      recentMessages: [...(channel.recentMessages ?? []), nextMessage].slice(
        -this.maxMessagesPerChannel
      ),
      coalitions: channel.coalitions,
      conflicts: channel.conflicts,
    });
  }

  async createCoalition(channelId, input = {}) {
    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Unknown shared context channel: ${channelId}`);
    }

    const coalition = normalizeCoalition(input);
    const existingIndex = channel.coalitions.findIndex(
      (entry) => entry.id === coalition.id
    );
    const coalitions = [...channel.coalitions];

    if (existingIndex >= 0) {
      coalitions[existingIndex] = {
        ...coalitions[existingIndex],
        ...coalition,
        createdAt: coalitions[existingIndex].createdAt,
        updatedAt: new Date().toISOString(),
      };
    } else {
      coalitions.push(coalition);
    }

    return this.upsertChannel({
      channelId: channel.id,
      members: channel.members,
      topic: channel.topic,
      metadata: channel.metadata,
      facts: channel.facts,
      recentMessages: channel.recentMessages,
      coalitions,
      conflicts: channel.conflicts,
    });
  }

  async addCoalitionMember(channelId, coalitionId, personalityId) {
    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Unknown shared context channel: ${channelId}`);
    }

    const coalition = channel.coalitions.find(
      (entry) => entry.id === normalizeId(coalitionId)
    );

    if (!coalition) {
      throw new Error(
        `Unknown coalition ${coalitionId} in channel ${channelId}.`
      );
    }

    return this.createCoalition(channelId, {
      ...coalition,
      members: [...coalition.members, personalityId],
      updatedAt: new Date().toISOString(),
    });
  }

  async removeCoalitionMember(channelId, coalitionId, personalityId) {
    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Unknown shared context channel: ${channelId}`);
    }

    const coalition = channel.coalitions.find(
      (entry) => entry.id === normalizeId(coalitionId)
    );

    if (!coalition) {
      throw new Error(
        `Unknown coalition ${coalitionId} in channel ${channelId}.`
      );
    }

    return this.createCoalition(channelId, {
      ...coalition,
      members: coalition.members.filter(
        (entry) => entry !== normalizeId(personalityId)
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  async deleteCoalition(channelId, coalitionId) {
    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Unknown shared context channel: ${channelId}`);
    }

    return this.upsertChannel({
      channelId: channel.id,
      members: channel.members,
      topic: channel.topic,
      metadata: channel.metadata,
      facts: channel.facts,
      recentMessages: channel.recentMessages,
      coalitions: channel.coalitions.filter(
        (entry) => entry.id !== normalizeId(coalitionId)
      ),
      conflicts: channel.conflicts,
    });
  }

  async declareConflict(channelId, input = {}) {
    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Unknown shared context channel: ${channelId}`);
    }

    const conflict = normalizeConflict(input);
    const existingIndex = channel.conflicts.findIndex(
      (entry) =>
        entry.active &&
        ((entry.initiatorId === conflict.initiatorId &&
          entry.targetId === conflict.targetId) ||
          (entry.initiatorId === conflict.targetId &&
            entry.targetId === conflict.initiatorId))
    );
    const conflicts = [...channel.conflicts];

    if (existingIndex >= 0) {
      conflicts[existingIndex] = {
        ...conflicts[existingIndex],
        ...conflict,
        updatedAt: new Date().toISOString(),
        active: true,
        resolvedAt: null,
        resolverId: null,
      };
    } else {
      conflicts.push(conflict);
    }

    return this.upsertChannel({
      channelId: channel.id,
      members: channel.members,
      topic: channel.topic,
      metadata: channel.metadata,
      facts: channel.facts,
      recentMessages: channel.recentMessages,
      coalitions: channel.coalitions,
      conflicts,
    });
  }

  async resolveConflict(channelId, conflictId, resolverId = null) {
    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Unknown shared context channel: ${channelId}`);
    }

    const conflicts = channel.conflicts.map((entry) =>
      entry.id === normalizeId(conflictId)
        ? {
            ...entry,
            active: false,
            resolvedAt: new Date().toISOString(),
            resolverId: normalizeId(resolverId ?? null) || null,
            updatedAt: new Date().toISOString(),
          }
        : entry
    );

    return this.upsertChannel({
      channelId: channel.id,
      members: channel.members,
      topic: channel.topic,
      metadata: channel.metadata,
      facts: channel.facts,
      recentMessages: channel.recentMessages,
      coalitions: channel.coalitions,
      conflicts,
    });
  }
}
