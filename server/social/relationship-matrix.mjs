import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRelationshipMatrixPath = path.join(
  __dirname,
  'data',
  'relationship-matrix.json'
);

function createInitialState() {
  return {
    lastUpdatedAt: null,
    relations: [],
  };
}

function normalizeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value ?? 0)));
}

function normalizeRelation(input = {}) {
  const sourcePersonalityId = normalizeId(
    input.sourcePersonalityId ?? input.personalityA
  );
  const targetPersonalityId = normalizeId(
    input.targetPersonalityId ?? input.personalityB
  );

  return {
    id: input.id ?? `${sourcePersonalityId}::${targetPersonalityId}`,
    sourcePersonalityId,
    targetPersonalityId,
    trust: clamp(input.trust ?? 0.5),
    affection: clamp(input.affection ?? 0, -1, 1),
    dominance: clamp(input.dominance ?? 0.5),
    lastUpdatedAt: input.lastUpdatedAt ?? new Date().toISOString(),
    notes: String(input.notes ?? '').trim() || null,
  };
}

export class RelationshipMatrix {
  constructor(options = {}) {
    this.filePath =
      options.filePath ??
      process.env.PANTHEON_RELATIONSHIP_MATRIX_PATH ??
      defaultRelationshipMatrixPath;
    this.maxRelations = Number(options.maxRelations ?? 400);
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
        relations: Array.isArray(parsed.relations)
          ? parsed.relations
              .map((entry) => normalizeRelation(entry))
              .filter(
                (entry) =>
                  entry.sourcePersonalityId && entry.targetPersonalityId
              )
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

  get(sourcePersonalityId, targetPersonalityId) {
    const sourceId = normalizeId(sourcePersonalityId);
    const targetId = normalizeId(targetPersonalityId);

    if (!sourceId || !targetId) {
      return null;
    }

    return (
      this.state.relations.find(
        (entry) =>
          entry.sourcePersonalityId === sourceId &&
          entry.targetPersonalityId === targetId
      ) ?? null
    );
  }

  getOrDefault(sourcePersonalityId, targetPersonalityId) {
    return (
      this.get(sourcePersonalityId, targetPersonalityId) ??
      normalizeRelation({
        sourcePersonalityId,
        targetPersonalityId,
      })
    );
  }

  listForPersonality(personalityId, limit = 20) {
    const normalizedId = normalizeId(personalityId);
    const boundedLimit = Math.max(1, Number(limit ?? 20) || 20);
    const relations = this.state.relations
      .filter((entry) => entry.sourcePersonalityId === normalizedId)
      .sort(
        (left, right) =>
          new Date(right.lastUpdatedAt).getTime() -
          new Date(left.lastUpdatedAt).getTime()
      )
      .slice(0, boundedLimit);

    return {
      personalityId: normalizedId,
      total: this.state.relations.filter(
        (entry) => entry.sourcePersonalityId === normalizedId
      ).length,
      relations,
    };
  }

  async set(input = {}) {
    const relation = normalizeRelation(input);

    if (!relation.sourcePersonalityId || !relation.targetPersonalityId) {
      throw new Error(
        'Relationship set requires source and target personalities.'
      );
    }

    const existingIndex = this.state.relations.findIndex(
      (entry) => entry.id === relation.id
    );

    if (existingIndex >= 0) {
      this.state.relations[existingIndex] = relation;
    } else {
      this.state.relations = [...this.state.relations, relation].slice(
        -this.maxRelations
      );
    }

    await this.flush();
    return relation;
  }

  async update(sourcePersonalityId, targetPersonalityId, delta = {}) {
    const current = this.getOrDefault(sourcePersonalityId, targetPersonalityId);
    return this.set({
      ...current,
      trust: clamp(Number(current.trust ?? 0.5) + Number(delta.trust ?? 0)),
      affection: clamp(
        Number(current.affection ?? 0) + Number(delta.affection ?? 0),
        -1,
        1
      ),
      dominance: clamp(
        Number(current.dominance ?? 0.5) + Number(delta.dominance ?? 0)
      ),
      notes: delta.notes ?? current.notes ?? null,
      lastUpdatedAt: new Date().toISOString(),
    });
  }
}
