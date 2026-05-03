import { BaseAgent } from './base-agent.mjs';

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function average(values = []) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values = []) {
  if (values.length === 0) {
    return 0;
  }

  const meanValue = average(values);
  return average(values.map((value) => (value - meanValue) ** 2));
}

function tokenizeText(text) {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

class MathAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: 'mathanalysis',
      description:
        'Специализированный математический агент для расчётов, моделирования, неопределённости и вычислительных планов.',
      tags: ['math', 'fem', 'forecast', 'monte-carlo', 'uncertainty'],
      recommendedPersonalityClasses: [
        'Игрок',
        'Архитектор-Конструктор',
        'Стратег',
      ],
      recommendedPersonalityIds: ['game-solver', 'architect'],
      notes: [
        'Phase 1: лёгкие локальные вычисления и solver planning.',
        'Phase 2+: FEM/PDE/series workers and model-backed forecasting.',
      ],
    });
  }

  async decisionTree(params = {}) {
    const options = Array.isArray(params.options) ? params.options : [];
    const evaluated = options.map((option) => {
      const outcomes = Array.isArray(option.outcomes) ? option.outcomes : [];
      const expectedValue = outcomes.reduce(
        (sum, outcome) =>
          sum +
          toFiniteNumber(outcome.probability, 0) *
            toFiniteNumber(outcome.value, 0),
        0
      );

      return {
        name: String(option.name ?? 'option'),
        expectedValue: Number(expectedValue.toFixed(3)),
        outcomeCount: outcomes.length,
      };
    });
    const bestOption =
      evaluated
        .slice()
        .sort((left, right) => right.expectedValue - left.expectedValue)[0] ??
      null;

    return {
      summary: bestOption
        ? `Лучшая ветка по ожидаемой ценности: ${bestOption.name}.`
        : 'Для дерева решений нужны варианты с outcomes.',
      evaluatedOptions: evaluated,
      bestOption,
    };
  }

  async monteCarlo(params = {}) {
    const samples = Array.isArray(params.samples)
      ? params.samples.map((value) => toFiniteNumber(value, 0))
      : [];

    if (samples.length === 0) {
      return {
        summary:
          'Phase 1 Monte Carlo ожидает готовый набор samples; генераторы распределений будут добавлены на следующем шаге.',
        iterations: 0,
        mean: 0,
        variance: 0,
        p10: 0,
        p90: 0,
      };
    }

    const sorted = [...samples].sort((left, right) => left - right);
    const percentile = (ratio) => {
      const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * ratio) - 1)
      );
      return sorted[index];
    };

    return {
      summary: 'Monte Carlo summary built from supplied samples.',
      iterations: samples.length,
      mean: Number(average(samples).toFixed(4)),
      variance: Number(variance(samples).toFixed(4)),
      p10: Number(percentile(0.1).toFixed(4)),
      p90: Number(percentile(0.9).toFixed(4)),
    };
  }

  async feaModelPlan(params = {}) {
    const structureType =
      String(params.structureType ?? 'beam').trim() || 'beam';

    return {
      summary: `Подготовлен Phase 1 solver plan для ${structureType}.`,
      solverStages: [
        'geometry-normalization',
        'material-assignment',
        'mesh-generation',
        'boundary-conditions',
        'linear-solve',
        'stress-and-deflection-report',
      ],
      recommendedMethods: [
        'finite-element-method',
        'stiffness-matrix-assembly',
        'load-combination-scan',
      ],
      nextWorker: 'mathanalysis/fea-worker',
    };
  }

  async forecastPlan(params = {}) {
    return {
      summary: 'Сформирован Phase 1 forecasting plan.',
      horizon: toFiniteNumber(params.horizon, 12),
      recommendedMethods: [
        'time-series-feature-extraction',
        'monte-carlo-scenario-tree',
        'bayesian-update-loop',
      ],
      uncertaintySources: [
        'market-regime-shift',
        'external-shocks',
        'data-lag',
      ],
    };
  }
}

class LingvoAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: 'lingvoanalysis',
      description:
        'Глубокий языковой агент для анализа текста, перефразирования, стилевой трансформации и knowledge-facing drafting.',
      tags: ['linguistics', 'style', 'paraphrase', 'knowledge'],
      recommendedPersonalityClasses: [
        'Писатель',
        'Психолог',
        'Психиатр',
        'Переводчик',
        'Юрист',
      ],
      recommendedPersonalityIds: ['writer', 'negotiator'],
      notes: [
        'Phase 1 uses deterministic heuristics and structured drafting.',
        'Phase 2+ can plug in local LLM/RAG backends.',
      ],
    });
  }

  async analyze(params = {}) {
    const text = String(params.text ?? '');
    const words = tokenizeText(text);
    const sentenceCount = text
      .split(/[.!?]+/)
      .map((entry) => entry.trim())
      .filter(Boolean).length;
    const tone = /!/.test(text)
      ? 'emphatic'
      : words.length > 24
        ? 'extended'
        : 'neutral';
    const domains = [
      ['law', /(договор|закон|право|юрист)/i],
      ['medicine', /(симптом|диагноз|анализ|медицина)/i],
      ['engineering', /(расчет|конструкция|балка|схема)/i],
      ['science', /(физик|хим|формул|теори)/i],
    ]
      .filter(([, pattern]) => pattern.test(text))
      .map(([label]) => label);

    return {
      summary: 'Выполнен структурный анализ текста.',
      metrics: {
        words: words.length,
        sentences: sentenceCount,
        averageWordLength: Number(
          (average(words.map((word) => word.length)) || 0).toFixed(2)
        ),
      },
      tone,
      candidateDomains: domains,
    };
  }

  async paraphrase(params = {}) {
    const text = String(params.text ?? '').trim();
    const style = String(params.style ?? 'neutral').trim() || 'neutral';
    const stylePrefix =
      {
        formal: 'Формально и чётко: ',
        literary: 'Литературно и плавно: ',
        concise: 'Кратко и по делу: ',
        neutral: 'Нейтрально: ',
      }[style] ?? `Стиль ${style}: `;

    return {
      summary: `Построено перефразирование в стиле ${style}.`,
      paraphrase: `${stylePrefix}${text}`,
      style,
    };
  }

  async generateSlang(params = {}) {
    const baseWords = Array.isArray(params.baseWords) ? params.baseWords : [];
    const suffix = String(params.suffix ?? '-wave').trim() || '-wave';

    return {
      summary: 'Сгенерирован компактный slang pack.',
      slang: baseWords.map((word) => `${String(word).trim()}${suffix}`),
    };
  }

  async askKnowledge(params = {}) {
    const domain = String(params.domain ?? 'general').trim() || 'general';
    const question = String(params.question ?? '').trim();

    return {
      summary: `Phase 1 knowledge routing prepared for domain ${domain}.`,
      answerDraft:
        question.length > 0
          ? `Вопрос зафиксирован для домена ${domain}: ${question}. На следующей фазе сюда подключается RAG/LLM backend.`
          : `Для домена ${domain} готов knowledge-routing placeholder.`,
      sourcesPlanned: ['local-rag', 'wikipedia', 'domain-corpus'],
    };
  }
}

class ArtAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: 'artanalysis',
      description:
        'Агент анализа и концепт-дизайна для изображений, видео, 3D-объектов и художественных стилей.',
      tags: ['art', 'design', 'image', 'video', '3d'],
      recommendedPersonalityClasses: ['Скульптор', 'Художник', 'Дизайнер'],
      recommendedPersonalityIds: ['artist'],
      notes: [
        'Phase 1 returns structured creative briefs and style maps.',
        'Phase 2+ integrates generator backends and 3D worker flows.',
      ],
    });
  }

  async analyzeArtifact(params = {}) {
    const prompt = String(params.prompt ?? '').trim();
    const medium = String(params.medium ?? 'image').trim() || 'image';

    return {
      summary: `Выполнен art brief analysis для medium=${medium}.`,
      composition: [
        'subject-focus',
        'supporting-shape-rhythm',
        'color-contrast',
      ],
      styleDirections: [
        'structural-modernism',
        'mythic-minimalism',
        'annotated-concept-art',
      ],
      prompt,
    };
  }

  async generateConcept(params = {}) {
    const prompt = String(params.prompt ?? '').trim();
    const medium = String(params.medium ?? 'image').trim() || 'image';

    return {
      summary: `Сформирован creative concept для ${medium}.`,
      concept: {
        prompt,
        medium,
        palette: ['oxide-red', 'sand', 'graphite'],
        cameraOrView:
          medium === 'video'
            ? 'slow orbit with close-up details'
            : 'front three-quarter view',
        deliverables:
          medium === '3d'
            ? ['obj', 'stl', 'render-turntable']
            : ['prompt-pack', 'style-sheet'],
      },
    };
  }

  async generate3DPlan(params = {}) {
    return {
      summary: 'Подготовлен 3D pipeline plan.',
      pipeline: [
        'concept-sketch',
        'mesh-blockout',
        'surface-pass',
        'export-obj-stl',
      ],
      targetTooling: ['blender-worker', 'autocad-exporter'],
      prompt: String(params.prompt ?? '').trim(),
    };
  }
}

class MedicalAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: 'medicalanalysis',
      description:
        'Медицинский аналитический агент для triage, symptom clustering и подготовки безопасных next-step summaries.',
      tags: ['medical', 'triage', 'safety'],
      recommendedPersonalityClasses: ['Врач', 'Психиатр', 'Психолог'],
      notes: [
        'Не заменяет врача; выдаёт safe analysis scaffold и triage hints.',
      ],
    });
  }

  async triageSymptoms(params = {}) {
    const symptoms = Array.isArray(params.symptoms) ? params.symptoms : [];
    const urgent = symptoms.some((entry) =>
      /(кров|не дыш|потеря сознания|сильная боль)/i.test(String(entry))
    );

    return {
      summary: urgent
        ? 'Обнаружены потенциально срочные симптомы; нужен очный medical escalation path.'
        : 'Сформирован безопасный triage summary.',
      urgency: urgent ? 'urgent' : 'routine',
      nextSteps: urgent
        ? ['seek-emergency-care', 'avoid-self-treatment-only']
        : ['collect-duration-history', 'track-temperature-and-triggers'],
      disclaimer:
        'Это вспомогательный аналитический модуль и не заменяет медицинскую диагностику.',
    };
  }
}

class LegalAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: 'legalanalysis',
      description:
        'Юридический аналитический агент для issue spotting, contract review scaffolds и risk summaries.',
      tags: ['legal', 'contracts', 'risk'],
      recommendedPersonalityClasses: ['Юрист', 'Переводчик'],
    });
  }

  async analyzeRisk(params = {}) {
    const text = String(params.text ?? '');
    const issues = [];

    if (/штраф|неустойк/i.test(text)) {
      issues.push('penalty-clause');
    }
    if (/эксклюзив|exclusive/i.test(text)) {
      issues.push('exclusivity');
    }
    if (/авторск|интеллектуаль/i.test(text)) {
      issues.push('ip-rights');
    }

    return {
      summary: 'Сформирован Phase 1 legal risk summary.',
      issues,
      nextReviewAngles: ['jurisdiction', 'termination-rights', 'liability-cap'],
      disclaimer: 'Требуется проверка квалифицированным юристом.',
    };
  }
}

class EconomicAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: 'economicanalysis',
      description:
        'Экономический и рыночный агент для сценарного прогноза и портфельного planning.',
      tags: ['economics', 'markets', 'forecast'],
      recommendedPersonalityClasses: ['Инвестор', 'Брокер', 'Финансист'],
    });
  }

  async scenarioForecast(params = {}) {
    const signals = Array.isArray(params.signals) ? params.signals : [];

    return {
      summary: 'Построен сценарный экономический прогноз.',
      scenarios: [
        {
          name: 'base',
          probability: 0.5,
          driver: signals[0] ?? 'stable-demand',
        },
        {
          name: 'bull',
          probability: 0.25,
          driver: signals[1] ?? 'productivity-upside',
        },
        {
          name: 'bear',
          probability: 0.25,
          driver: signals[2] ?? 'liquidity-shock',
        },
      ],
    };
  }
}

class CodeAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: 'codeanalysis',
      description:
        'Агент анализа кода для review summaries, refactor planning и defect triage.',
      tags: ['code', 'review', 'refactor'],
      recommendedPersonalityClasses: ['Программист', 'DevOps'],
    });
  }

  async reviewSnippet(params = {}) {
    const code = String(params.code ?? '');
    const lines = code.split('\n');
    const findings = [];

    if (code.includes('eval(') || code.includes('Function(')) {
      findings.push('dynamic-code-execution');
    }
    if (lines.some((line) => line.length > 120)) {
      findings.push('long-lines');
    }

    return {
      summary: 'Сформирован lightweight code review summary.',
      language: String(params.language ?? 'unknown'),
      metrics: {
        lines: lines.length,
        findings: findings.length,
      },
      findings,
    };
  }
}

class GameTheoryAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: 'gametheoryanalysis',
      description:
        'Агент теории игр для payoff-матриц, стратегических решений и равновесных heuristics.',
      tags: ['game-theory', 'strategy', 'payoff'],
      recommendedPersonalityClasses: ['Игрок', 'Стратег'],
      recommendedPersonalityIds: ['game-solver'],
    });
  }

  async payoffMatrix(params = {}) {
    const matrix = Array.isArray(params.matrix) ? params.matrix : [];
    const rowStrategies = Array.isArray(params.rowStrategies)
      ? params.rowStrategies
      : matrix.map((_, index) => `row-${index + 1}`);
    const rowMins = matrix.map((row) =>
      Math.min(
        ...(Array.isArray(row)
          ? row.map((value) => toFiniteNumber(value, 0))
          : [0])
      )
    );
    const maximin = rowMins.length > 0 ? Math.max(...rowMins) : 0;
    const bestRowIndex = rowMins.indexOf(maximin);

    return {
      summary: 'Вычислен maximin-oriented strategic hint.',
      recommendedRowStrategy:
        bestRowIndex >= 0 ? rowStrategies[bestRowIndex] : null,
      maximin: Number(maximin.toFixed(3)),
      rowSecurityLevels: rowStrategies.map((name, index) => ({
        name,
        securityLevel: Number((rowMins[index] ?? 0).toFixed(3)),
      })),
    };
  }
}

export class SpecialistAgentRegistry {
  constructor() {
    this.agents = new Map(
      [
        new MathAnalysisAgent(),
        new LingvoAnalysisAgent(),
        new ArtAnalysisAgent(),
        new MedicalAnalysisAgent(),
        new LegalAnalysisAgent(),
        new EconomicAnalysisAgent(),
        new CodeAnalysisAgent(),
        new GameTheoryAnalysisAgent(),
      ].map((agent) => [agent.name, agent])
    );
  }

  listAgents() {
    return [...this.agents.values()].map((agent) => agent.getCatalogEntry());
  }

  getAgent(name) {
    return (
      this.agents.get(
        String(name ?? '')
          .trim()
          .toLowerCase()
      ) ?? null
    );
  }

  async execute(agentName, method, params = {}, context = {}) {
    const agent = this.getAgent(agentName);

    if (!agent) {
      const error = new Error(`Unknown specialist agent: ${agentName}`);
      error.statusCode = 404;
      throw error;
    }

    return agent.execute(method, params, context);
  }
}
