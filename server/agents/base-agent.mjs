function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export class BaseAgent {
  constructor(options = {}) {
    this.name = options.name ?? 'agent';
    this.description = options.description ?? '';
    this.tags = options.tags ?? [];
    this.recommendedPersonalityClasses =
      options.recommendedPersonalityClasses ?? [];
    this.recommendedPersonalityIds = options.recommendedPersonalityIds ?? [];
    this.notes = options.notes ?? [];
    this.cache = new Map();
  }

  getCatalogEntry() {
    const methodNames = Object.getOwnPropertyNames(
      Object.getPrototypeOf(this)
    ).filter(
      (name) =>
        ![
          'constructor',
          'execute',
          'getCatalogEntry',
          'buildCacheKey',
        ].includes(name) && typeof this[name] === 'function'
    );

    return {
      name: this.name,
      description: this.description,
      tags: this.tags,
      methods: methodNames,
      recommendedPersonalityClasses: this.recommendedPersonalityClasses,
      recommendedPersonalityIds: this.recommendedPersonalityIds,
      notes: this.notes,
    };
  }

  buildCacheKey(method, params) {
    return `${method}:${stableStringify(params)}`;
  }

  async execute(method, params = {}, context = {}) {
    if (typeof this[method] !== 'function') {
      const error = new Error(
        `Agent ${this.name} does not support method ${method}.`
      );
      error.statusCode = 404;
      throw error;
    }

    const cacheKey = this.buildCacheKey(method, params);

    if (this.cache.has(cacheKey)) {
      return {
        ...(this.cache.get(cacheKey) ?? {}),
        cacheHit: true,
      };
    }

    const result = await this[method](params, context);
    const normalizedResult = {
      agent: this.name,
      method,
      executedAt: new Date().toISOString(),
      cacheHit: false,
      ...result,
    };

    this.cache.set(cacheKey, normalizedResult);
    return normalizedResult;
  }
}
