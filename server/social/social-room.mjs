import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSocialRoomsPath = path.join(
  __dirname,
  'data',
  'social-rooms.json'
);

function createInitialState() {
  return {
    lastUpdatedAt: null,
    rooms: [],
    activeSessions: [],
  };
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

function normalizeRoom(room = {}) {
  const roomId = normalizeId(room.id ?? room.roomId ?? room.name);
  const name = String(room.name ?? roomId).trim();
  const members = uniqueIds(room.members ?? []);

  return {
    id: roomId,
    name: name || roomId,
    channelId: normalizeId(room.channelId ?? `room-${roomId}`),
    createdAt: room.createdAt ?? new Date().toISOString(),
    updatedAt: room.updatedAt ?? new Date().toISOString(),
    topic: room.topic ? String(room.topic).trim() : null,
    members,
    archivedAt: room.archivedAt ?? null,
    metadata:
      typeof room.metadata === 'object' && room.metadata
        ? { ...room.metadata }
        : {},
  };
}

function normalizeSession(session = {}) {
  const userId = String(session.userId ?? '').trim();
  const personalityId = normalizeId(session.personalityId);
  const key = String(session.key ?? `${userId}::${personalityId}`).trim();

  return {
    key,
    userId,
    personalityId,
    roomId: normalizeId(session.roomId),
    updatedAt: session.updatedAt ?? new Date().toISOString(),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class SocialRoomManager {
  constructor(options = {}) {
    this.filePath =
      options.filePath ??
      process.env.PANTHEON_SOCIAL_ROOMS_PATH ??
      defaultSocialRoomsPath;
    this.sharedContext = options.sharedContext;
    this.socialChannel = options.socialChannel;
    this.eventSink = options.eventSink;
    this.maxRooms = Number(options.maxRooms ?? 40);
    this.maxActiveSessions = Number(options.maxActiveSessions ?? 200);
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
        rooms: Array.isArray(parsed.rooms)
          ? parsed.rooms
              .map((room) => normalizeRoom(room))
              .filter((room) => room.id)
          : [],
        activeSessions: Array.isArray(parsed.activeSessions)
          ? parsed.activeSessions
              .map((session) => normalizeSession(session))
              .filter((session) => session.key && session.roomId)
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

    return this.getStatus();
  }

  async flush() {
    this.state.lastUpdatedAt = new Date().toISOString();
    await writeFile(
      this.filePath,
      `${JSON.stringify(this.state, null, 2)}\n`,
      'utf8'
    );
  }

  getStatus() {
    return {
      roomCount: this.state.rooms.filter((room) => !room.archivedAt).length,
      activeSessionCount: this.state.activeSessions.length,
      lastUpdatedAt: this.state.lastUpdatedAt,
    };
  }

  async emitEvent(kind, payload = {}) {
    if (typeof this.eventSink !== 'function') {
      return;
    }

    await this.eventSink({
      kind,
      createdAt: new Date().toISOString(),
      ...payload,
    });
  }

  listRooms(limit = 20) {
    const boundedLimit = Math.max(
      1,
      Math.min(this.maxRooms, Number(limit ?? 20) || 20)
    );
    const rooms = this.state.rooms
      .filter((room) => !room.archivedAt)
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
      )
      .slice(0, boundedLimit)
      .map((room) => clone(room));

    return {
      total: this.state.rooms.filter((room) => !room.archivedAt).length,
      rooms,
    };
  }

  getRoom(roomId, options = {}) {
    const normalizedRoomId = normalizeId(roomId);
    const room =
      this.state.rooms.find(
        (entry) => entry.id === normalizedRoomId && !entry.archivedAt
      ) ?? null;

    if (!room) {
      return null;
    }

    const result = clone(room);

    if (options.includeChannel) {
      result.channel = this.sharedContext.getChannel(room.channelId);
    }

    return result;
  }

  getActiveRoom({ userId, personalityId }) {
    const key = `${String(userId ?? '').trim()}::${normalizeId(personalityId)}`;
    const session =
      this.state.activeSessions.find((entry) => entry.key === key) ?? null;

    if (!session) {
      return null;
    }

    return this.getRoom(session.roomId, { includeChannel: true });
  }

  async setActiveRoom({ userId, personalityId, roomId }) {
    const key = `${String(userId ?? '').trim()}::${normalizeId(personalityId)}`;
    const nextSession = normalizeSession({
      key,
      userId,
      personalityId,
      roomId,
      updatedAt: new Date().toISOString(),
    });
    const existingIndex = this.state.activeSessions.findIndex(
      (entry) => entry.key === nextSession.key
    );

    if (existingIndex >= 0) {
      this.state.activeSessions[existingIndex] = nextSession;
    } else {
      this.state.activeSessions = [
        ...this.state.activeSessions,
        nextSession,
      ].slice(-this.maxActiveSessions);
    }

    await this.flush();
    return nextSession;
  }

  async clearActiveRoom({ userId, personalityId, roomId = null }) {
    const key = `${String(userId ?? '').trim()}::${normalizeId(personalityId)}`;
    const nextSessions = this.state.activeSessions.filter((entry) => {
      if (entry.key !== key) {
        return true;
      }

      if (roomId && entry.roomId !== normalizeId(roomId)) {
        return true;
      }

      return false;
    });

    if (nextSessions.length === this.state.activeSessions.length) {
      return false;
    }

    this.state.activeSessions = nextSessions;
    await this.flush();
    return true;
  }

  async saveRoom(input = {}) {
    const roomId = normalizeId(input.roomId ?? input.id ?? input.name);

    if (!roomId) {
      throw new Error('Social room requires roomId or name.');
    }

    const existingIndex = this.state.rooms.findIndex(
      (room) => room.id === roomId
    );
    const existing =
      existingIndex >= 0 ? this.state.rooms[existingIndex] : null;
    const members = uniqueIds(input.members ?? existing?.members ?? []);
    const room = normalizeRoom({
      ...(existing ?? {}),
      id: roomId,
      name: input.name ?? existing?.name ?? roomId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      channelId: input.channelId ?? existing?.channelId ?? `room-${roomId}`,
      topic: input.topic ?? existing?.topic ?? null,
      members,
      archivedAt: input.archivedAt ?? existing?.archivedAt ?? null,
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
    });

    const channel = await this.sharedContext.upsertChannel({
      channelId: room.channelId,
      members: room.members,
      topic: room.topic,
      metadata: {
        roomId: room.id,
        roomName: room.name,
        room: true,
        archivedAt: room.archivedAt,
        ...(room.metadata ?? {}),
      },
    });

    if (existingIndex >= 0) {
      this.state.rooms[existingIndex] = room;
    } else {
      this.state.rooms = [...this.state.rooms, room].slice(-this.maxRooms);
    }

    await this.flush();
    await this.emitEvent(existing ? 'room-updated' : 'room-created', {
      roomId: room.id,
      roomName: room.name,
      channelId: room.channelId,
      memberIds: room.members,
      topic: room.topic,
    });

    return {
      room: this.getRoom(room.id, { includeChannel: true }),
      channel,
    };
  }

  async createRoom(input = {}) {
    return this.saveRoom(input);
  }

  async addMembers(roomId, members = []) {
    const room = this.getRoom(roomId);

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    return this.saveRoom({
      roomId: room.id,
      members: [...room.members, ...members],
    });
  }

  async leaveRoom({ roomId, personalityId, userId = '' }) {
    const room = this.getRoom(roomId);
    const normalizedPersonalityId = normalizeId(personalityId);

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    const nextMembers = room.members.filter(
      (memberId) => memberId !== normalizedPersonalityId
    );
    const saved = await this.saveRoom({
      roomId: room.id,
      members: nextMembers,
    });
    await this.clearActiveRoom({
      userId,
      personalityId: normalizedPersonalityId,
      roomId: room.id,
    });
    await this.emitEvent('room-left', {
      roomId: room.id,
      personalityId: normalizedPersonalityId,
      memberIds: nextMembers,
    });
    return saved;
  }

  async deleteRoom(roomId) {
    const room = this.getRoom(roomId);

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    const saved = await this.saveRoom({
      roomId: room.id,
      archivedAt: new Date().toISOString(),
      metadata: {
        ...(room.metadata ?? {}),
        archived: true,
      },
    });

    this.state.activeSessions = this.state.activeSessions.filter(
      (entry) => entry.roomId !== room.id
    );
    await this.flush();
    await this.emitEvent('room-deleted', {
      roomId: room.id,
      roomName: room.name,
      channelId: room.channelId,
    });
    return saved;
  }

  async sendToRoom(payload = {}) {
    const room = this.getRoom(payload.roomId, { includeChannel: true });
    const sourcePersonalityId = normalizeId(
      payload.sourcePersonalityId ?? payload.personalityId ?? payload.from
    );

    if (!room) {
      throw new Error(`Unknown social room: ${payload.roomId}`);
    }

    if (!sourcePersonalityId) {
      throw new Error('Social room send requires sourcePersonalityId.');
    }

    if (!room.members.includes(sourcePersonalityId)) {
      throw new Error(
        `Personality ${sourcePersonalityId} is not a member of room ${room.id}.`
      );
    }

    const explicitTargetId = normalizeId(
      payload.targetPersonalityId ?? payload.to ?? null
    );

    if (explicitTargetId && !room.members.includes(explicitTargetId)) {
      throw new Error(
        `Target personality ${explicitTargetId} is not a member of room ${room.id}.`
      );
    }

    if (payload.userId) {
      await this.setActiveRoom({
        userId: payload.userId,
        personalityId: sourcePersonalityId,
        roomId: room.id,
      });
    }

    const result = await this.socialChannel.talk({
      ...payload,
      sourcePersonalityId,
      channelId: room.channelId,
      topic: payload.topic ?? room.topic ?? room.name,
      targetPersonalityId: explicitTargetId || undefined,
    });

    await this.emitEvent('room-message', {
      roomId: room.id,
      roomName: room.name,
      channelId: room.channelId,
      sourcePersonalityId,
      targetPersonalityId: explicitTargetId || null,
      topic: result.topic,
      transcriptLength: result.transcript?.length ?? 0,
    });

    return {
      ...result,
      room: this.getRoom(room.id, { includeChannel: true }),
      roomId: room.id,
      roomName: room.name,
    };
  }

  async createCoalition(roomId, input = {}) {
    const room = this.getRoom(roomId, { includeChannel: true });

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    const channel = await this.sharedContext.createCoalition(
      room.channelId,
      input
    );
    await this.emitEvent('room-coalition-created', {
      roomId: room.id,
      channelId: room.channelId,
      coalitionId: input.id ?? input.name,
    });
    return {
      room: this.getRoom(room.id, { includeChannel: true }),
      channel,
    };
  }

  async joinCoalition(roomId, coalitionId, personalityId) {
    const room = this.getRoom(roomId, { includeChannel: true });

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    const channel = await this.sharedContext.addCoalitionMember(
      room.channelId,
      coalitionId,
      personalityId
    );
    await this.emitEvent('room-coalition-joined', {
      roomId: room.id,
      channelId: room.channelId,
      coalitionId,
      personalityId: normalizeId(personalityId),
    });
    return {
      room: this.getRoom(room.id, { includeChannel: true }),
      channel,
    };
  }

  async leaveCoalition(roomId, coalitionId, personalityId) {
    const room = this.getRoom(roomId, { includeChannel: true });

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    const channel = await this.sharedContext.removeCoalitionMember(
      room.channelId,
      coalitionId,
      personalityId
    );
    await this.emitEvent('room-coalition-left', {
      roomId: room.id,
      channelId: room.channelId,
      coalitionId,
      personalityId: normalizeId(personalityId),
    });
    return {
      room: this.getRoom(room.id, { includeChannel: true }),
      channel,
    };
  }

  async declareConflict(roomId, input = {}) {
    const room = this.getRoom(roomId, { includeChannel: true });

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    const channel = await this.sharedContext.declareConflict(
      room.channelId,
      input
    );
    await this.emitEvent('room-conflict-declared', {
      roomId: room.id,
      channelId: room.channelId,
      initiatorId: normalizeId(input.initiatorId),
      targetId: normalizeId(input.targetId),
    });
    return {
      room: this.getRoom(room.id, { includeChannel: true }),
      channel,
    };
  }

  async resolveConflict(roomId, conflictId, resolverId = null) {
    const room = this.getRoom(roomId, { includeChannel: true });

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    const channel = await this.sharedContext.resolveConflict(
      room.channelId,
      conflictId,
      resolverId
    );
    await this.emitEvent('room-conflict-resolved', {
      roomId: room.id,
      channelId: room.channelId,
      conflictId: normalizeId(conflictId),
      resolverId: normalizeId(resolverId),
    });
    return {
      room: this.getRoom(room.id, { includeChannel: true }),
      channel,
    };
  }

  async deleteCoalition(roomId, coalitionId) {
    const room = this.getRoom(roomId, { includeChannel: true });

    if (!room) {
      throw new Error(`Unknown social room: ${roomId}`);
    }

    const channel = await this.sharedContext.deleteCoalition(
      room.channelId,
      coalitionId
    );
    await this.emitEvent('room-coalition-deleted', {
      roomId: room.id,
      channelId: room.channelId,
      coalitionId: normalizeId(coalitionId),
    });
    return {
      room: this.getRoom(room.id, { includeChannel: true }),
      channel,
    };
  }
}
