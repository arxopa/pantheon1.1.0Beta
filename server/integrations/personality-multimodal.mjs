import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultCacheRoot = path.join(
  __dirname,
  '..',
  'dialog',
  'data',
  'multimodal-cache'
);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value ?? 0)));
}

function sanitizeName(value, fallback = 'artifact') {
  const normalized = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-');
  return normalized || fallback;
}

function encodeBase64(value) {
  return Buffer.isBuffer(value)
    ? value.toString('base64')
    : Buffer.from(String(value ?? ''), 'utf8').toString('base64');
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value ?? null);
}

function hashPayload(value) {
  return createHash('sha256')
    .update(stableJson(value))
    .digest('hex')
    .slice(0, 16);
}

function normalizeProvider(value, fallback) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return normalized || fallback;
}

function uniqueStrings(values = [], limit = 6) {
  return [
    ...new Set(
      values.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    ),
  ].slice(0, limit);
}

function buildPaletteText(palette = []) {
  return Array.isArray(palette) && palette.length > 0
    ? palette.join(', ')
    : null;
}

function buildPromptEnvelope(parts = []) {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

function summarizeBinaryInput(input = {}) {
  const dataBase64 = String(input.dataBase64 ?? '').trim();
  const mimeType =
    String(input.mimeType ?? '').trim() || 'application/octet-stream';
  const fileName = String(input.fileName ?? '').trim() || null;
  const approxBytes = dataBase64 ? Math.round((dataBase64.length * 3) / 4) : 0;
  return {
    dataBase64,
    mimeType,
    fileName,
    approxBytes,
    hasUpload: Boolean(dataBase64),
  };
}

function buildWavBuffer({
  frequency = 440,
  durationMs = 900,
  sampleRate = 22050,
  amplitude = 0.25,
}) {
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const envelope = Math.min(
      1,
      index / (sampleRate * 0.03),
      (sampleCount - index) / (sampleRate * 0.04)
    );
    const sample =
      Math.sin(2 * Math.PI * frequency * time) * amplitude * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }

  return buffer;
}

function createSvgCard({
  title,
  subtitle,
  body,
  accent = '#7cc6ff',
  background = '#102034',
}) {
  const lines = [String(subtitle ?? ''), ...String(body ?? '').split('\n')]
    .filter(Boolean)
    .slice(0, 8);
  const escaped = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const lineMarkup = lines
    .map(
      (line, index) =>
        `<text x="36" y="${118 + index * 34}" fill="#e8f2ff" font-size="20">${escaped(line)}</text>`
    )
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576" viewBox="0 0 1024 576">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${background}" />
          <stop offset="100%" stop-color="#1f3859" />
        </linearGradient>
      </defs>
      <rect width="1024" height="576" fill="url(#bg)" rx="32" />
      <circle cx="878" cy="114" r="86" fill="${accent}" opacity="0.18" />
      <circle cx="820" cy="178" r="34" fill="${accent}" opacity="0.34" />
      <text x="36" y="72" fill="#ffffff" font-size="42" font-weight="700">${escaped(title)}</text>
      ${lineMarkup}
    </svg>
  `.trim();
}

async function maybeCallJsonApi(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`${url} failed: ${response.status} ${details}`);
  }

  return response;
}

export class PersonalityMultimodal {
  constructor(options = {}) {
    this.personalityManager = options.personalityManager;
    this.videoExecutor = options.videoExecutor ?? null;
    this.cacheRoot =
      options.cacheRoot ??
      process.env.PANTHEON_MULTIMODAL_CACHE_ROOT ??
      defaultCacheRoot;
    this.ttsApiUrl =
      options.ttsApiUrl ?? process.env.PANTHEON_TTS_API_URL ?? null;
    this.sttApiUrl =
      options.sttApiUrl ?? process.env.PANTHEON_STT_API_URL ?? null;
    this.imageApiUrl =
      options.imageApiUrl ?? process.env.PANTHEON_IMAGE_API_URL ?? null;
    this.videoApiUrl =
      options.videoApiUrl ?? process.env.PANTHEON_VIDEO_API_URL ?? null;
    this.logs = [];
    this.logLimit = Number(options.logLimit ?? 200);
    this.cacheIndex = new Map();
    this.cacheLimit = Math.max(10, Number(options.cacheLimit ?? 100));
    this.cacheTtlMs = Math.max(
      60_000,
      Number(options.cacheTtlMs ?? 60 * 60 * 1000)
    );
    this.tasks = new Map();
  }

  async init() {
    await mkdir(this.cacheRoot, { recursive: true });
  }

  async log(event) {
    this.logs = [
      ...this.logs,
      {
        id: event.id ?? `multimodal-log-${Date.now()}`,
        createdAt: event.createdAt ?? new Date().toISOString(),
        ...event,
      },
    ].slice(-this.logLimit);
    return this.logs;
  }

  getLogs(limit = 60) {
    return [...this.logs].slice(-limit).reverse();
  }

  getStatus() {
    this.pruneCache();
    return {
      ttsConfigured: Boolean(this.ttsApiUrl),
      sttConfigured: Boolean(this.sttApiUrl),
      imageConfigured: Boolean(this.imageApiUrl),
      videoConfigured: Boolean(this.videoApiUrl),
      cacheRoot: this.cacheRoot,
      logCount: this.logs.length,
      cacheEntries: this.cacheIndex.size,
      cacheLimit: this.cacheLimit,
      cacheTtlMs: this.cacheTtlMs,
      activeTasks: [...this.tasks.values()].filter(
        (task) => task.status === 'queued' || task.status === 'running'
      ).length,
    };
  }

  getCacheStatus() {
    this.pruneCache();
    return {
      entries: this.cacheIndex.size,
      cacheLimit: this.cacheLimit,
      cacheTtlMs: this.cacheTtlMs,
      recentKeys: [...this.cacheIndex.keys()].slice(-10).reverse(),
    };
  }

  clearCache(options = {}) {
    const kind = String(options.kind ?? '')
      .trim()
      .toLowerCase();
    const personalityId = String(options.personalityId ?? '').trim();
    let cleared = 0;

    for (const [cacheKey, value] of this.cacheIndex.entries()) {
      if (kind && !cacheKey.startsWith(`${kind}:`)) {
        continue;
      }

      if (personalityId && value.personalityId !== personalityId) {
        continue;
      }

      this.cacheIndex.delete(cacheKey);
      cleared += 1;
    }

    return {
      ok: true,
      cleared,
      kind: kind || null,
      personalityId: personalityId || null,
      cache: this.getCacheStatus(),
    };
  }

  pruneCache() {
    const now = Date.now();

    for (const [cacheKey, value] of this.cacheIndex.entries()) {
      const expiresAt = Number(value.expiresAtMs ?? 0);

      if (expiresAt > 0 && expiresAt <= now) {
        this.cacheIndex.delete(cacheKey);
      }
    }

    while (this.cacheIndex.size > this.cacheLimit) {
      const [oldestKey] = this.cacheIndex.keys();
      this.cacheIndex.delete(oldestKey);
    }
  }

  getTasks(limit = 40) {
    return [...this.tasks.values()].slice(-limit).reverse();
  }

  getTask(taskId) {
    const task = this.tasks.get(String(taskId ?? '').trim());
    return task ? { ...task } : null;
  }

  cancelTask(taskId) {
    const task = this.tasks.get(String(taskId ?? '').trim());

    if (!task) {
      return null;
    }

    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    ) {
      return task;
    }

    const updatedTask = {
      ...task,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    };
    this.tasks.set(updatedTask.id, updatedTask);
    return updatedTask;
  }

  startTask(kind, personalityId, input = {}) {
    const task = {
      id: `${kind}-task-${Date.now()}`,
      kind,
      personalityId,
      status: 'running',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      provider: input.provider ?? null,
      progressPct: Number(input.progressPct ?? 12),
      stage: input.stage ?? 'accepted',
      inputSummary: {
        text: String(input.text ?? '').slice(0, 120) || null,
        prompt: String(input.prompt ?? '').slice(0, 120) || null,
      },
    };
    this.tasks.set(task.id, task);
    return task;
  }

  finishTask(taskId, details = {}) {
    const task = this.tasks.get(taskId);

    if (!task) {
      return null;
    }

    const updatedTask = {
      ...task,
      ...details,
      status: details.status ?? 'completed',
      progressPct: Number(
        details.progressPct ??
          (details.status === 'cancelled' ? (task.progressPct ?? 0) : 100)
      ),
      completedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, updatedTask);
    return updatedTask;
  }

  resolveProvider(kind, personality, input = {}) {
    if (kind === 'tts') {
      return normalizeProvider(
        input.provider ?? input.audioProvider,
        personality.multimodal?.audioProvider ?? 'stub-voice-wave'
      );
    }

    if (kind === 'stt') {
      return normalizeProvider(input.provider, 'stub-stt');
    }

    if (kind === 'image') {
      return normalizeProvider(
        input.provider ?? input.imageProvider,
        personality.multimodal?.imageProvider ?? 'local-sd'
      );
    }

    if (kind === 'video') {
      return normalizeProvider(
        input.provider ?? input.videoProvider,
        personality.multimodal?.videoProvider ?? 'storyboard'
      );
    }

    return normalizeProvider(input.provider, 'stub');
  }

  resolveStyle(personality, input = {}) {
    const baseStyle = personality.multimodal?.style ?? {};
    const overrideStyle = input.style ?? {};
    return {
      palette: uniqueStrings(
        Array.isArray(overrideStyle.palette)
          ? overrideStyle.palette
          : (baseStyle.palette ?? [])
      ),
      imageTone: overrideStyle.imageTone ?? baseStyle.imageTone ?? null,
      voice: overrideStyle.voice ?? baseStyle.voice ?? null,
      music: {
        genre: overrideStyle.music?.genre ?? baseStyle.music?.genre ?? null,
        tempo: Number(
          overrideStyle.music?.tempo ?? baseStyle.music?.tempo ?? 92
        ),
      },
    };
  }

  shapeImagePrompt(prompt, personality, style) {
    return buildPromptEnvelope([
      prompt,
      personality.multimodal?.imageStyle,
      style.imageTone,
      buildPaletteText(style.palette)
        ? `palette ${buildPaletteText(style.palette)}`
        : null,
      personality.multimodal?.mediaQuirk,
      personality.profileDescription,
    ]);
  }

  shapeSpeechText(text, personality, style) {
    return buildPromptEnvelope([
      text,
      style.voice ? `delivery ${style.voice}` : null,
      personality.multimodal?.description,
      personality.dynamicState?.lastEmotion
        ? `emotion ${personality.dynamicState.lastEmotion}`
        : null,
    ]);
  }

  shapeVideoPrompt(prompt, personality, style, durationSeconds) {
    return buildPromptEnvelope([
      prompt,
      personality.multimodal?.videoStyle,
      style.imageTone,
      style.music?.genre ? `music ${style.music.genre}` : null,
      Number.isFinite(style.music?.tempo)
        ? `tempo ${Math.round(style.music.tempo)} bpm`
        : null,
      `duration ${durationSeconds}s`,
      personality.profileDescription,
    ]);
  }

  getCacheKey(kind, personalityId, payload = {}) {
    return `${kind}:${sanitizeName(personalityId)}:${hashPayload(payload)}`;
  }

  async getCachedArtifact(kind, personalityId, payload = {}) {
    this.pruneCache();
    const cacheKey = this.getCacheKey(kind, personalityId, payload);
    const cached = this.cacheIndex.get(cacheKey);

    if (!cached?.filePath) {
      return null;
    }

    if (Number(cached.expiresAtMs ?? 0) <= Date.now()) {
      this.cacheIndex.delete(cacheKey);
      return null;
    }

    this.cacheIndex.delete(cacheKey);
    this.cacheIndex.set(cacheKey, cached);

    const body = await readFile(cached.filePath);
    return {
      ...cached,
      dataBase64: encodeBase64(body),
      cacheHit: true,
    };
  }

  rememberArtifact(kind, personalityId, payload = {}, artifact) {
    this.pruneCache();
    const cacheKey = this.getCacheKey(kind, personalityId, payload);
    this.cacheIndex.set(cacheKey, {
      ...artifact,
      personalityId,
      dataBase64: null,
      cachedAt: new Date().toISOString(),
      expiresAtMs: Date.now() + this.cacheTtlMs,
    });

    this.pruneCache();
    return artifact;
  }

  async persistArtifact(personalityId, fileName, data) {
    const personalityDir = path.join(
      this.cacheRoot,
      sanitizeName(personalityId)
    );
    await mkdir(personalityDir, { recursive: true });
    const filePath = path.join(personalityDir, fileName);
    await writeFile(filePath, data);
    return filePath;
  }

  buildArtifact(personalityId, kind, mimeType, body, metadata = {}) {
    const fileName =
      metadata.fileName ??
      `${sanitizeName(kind)}-${Date.now()}.${metadata.extension ?? 'bin'}`;
    return {
      id: `${kind}-${Date.now()}`,
      personalityId,
      kind,
      provider: metadata.provider ?? 'stub',
      mode: metadata.mode ?? 'stub',
      mimeType,
      dataBase64: encodeBase64(body),
      fileName,
      previewText: metadata.previewText ?? null,
      prompt: metadata.prompt ?? null,
      description: metadata.description ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  async synthesizeSpeech(input = {}) {
    const personality = this.personalityManager.getPersonality(
      input.personalityId ?? 'default'
    );
    const text = String(input.text ?? '').trim();
    const provider = this.resolveProvider('tts', personality, input);
    const style = this.resolveStyle(personality, input);
    const shapedText = this.shapeSpeechText(text, personality, style);

    if (!text) {
      throw new Error('Text is required for speech synthesis.');
    }

    const cachePayload = {
      text,
      shapedText,
      provider,
      voice: personality.multimodal?.ttsVoice,
      voicePitch: personality.multimodal?.voicePitch,
      voiceRate: personality.multimodal?.voiceRate,
      voiceStyle: style.voice,
      emotion: personality.dynamicState?.lastEmotion,
    };
    const cached = await this.getCachedArtifact(
      'tts',
      personality.id,
      cachePayload
    );

    if (cached) {
      await this.log({
        kind: 'tts-cache',
        personalityId: personality.id,
        summary: `Cached TTS reused for ${personality.id}.`,
      });
      return cached;
    }

    const task = this.startTask('tts', personality.id, {
      text,
      provider,
      stage: 'voice-synthesis',
      progressPct: 18,
    });

    try {
      if (this.ttsApiUrl) {
        const response = await maybeCallJsonApi(this.ttsApiUrl, {
          text,
          shapedText,
          personalityId: personality.id,
          provider,
          voice: personality.multimodal?.ttsVoice,
          voicePitch: personality.multimodal?.voicePitch,
          voiceRate: personality.multimodal?.voiceRate,
          style,
        });
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const artifact = this.buildArtifact(
          personality.id,
          'tts',
          response.headers.get('content-type') ?? 'audio/mpeg',
          buffer,
          {
            extension: 'audio',
            provider,
            mode: 'remote',
            previewText: text.slice(0, 120),
            description: `Remote speech for ${personality.displayName} with ${style.voice ?? 'default'} delivery.`,
            fileName: `tts-${hashPayload(cachePayload)}.audio`,
          }
        );
        artifact.filePath = await this.persistArtifact(
          personality.id,
          artifact.fileName,
          buffer
        );
        this.rememberArtifact('tts', personality.id, cachePayload, artifact);
        await this.log({
          kind: 'tts',
          personalityId: personality.id,
          summary: `Remote TTS generated for ${personality.id} via ${provider}.`,
        });
        this.finishTask(task.id, {
          status: 'completed',
          artifactId: artifact.id,
          provider,
          progressPct: 100,
          stage: 'completed',
        });
        return artifact;
      }

      const frequency =
        250 +
        Math.round((personality.multimodal?.voicePitch ?? 1) * 180) +
        Math.round((personality.traits?.extraversion ?? 0.5) * 80);
      const durationMs = Math.min(2400, Math.max(700, text.length * 26));
      const wav = buildWavBuffer({
        frequency,
        durationMs,
        amplitude: 0.22 + clamp(personality.dynamicState?.energy ?? 0.6) * 0.12,
      });
      const artifact = this.buildArtifact(
        personality.id,
        'tts',
        'audio/wav',
        wav,
        {
          extension: 'wav',
          provider,
          mode: 'stub',
          previewText: `${personality.displayName}: ${text.slice(0, 160)}`,
          description: `Stub voice for ${personality.displayName} using ${personality.multimodal?.ttsVoice ?? 'default voice'} with ${style.voice ?? 'default'} delivery.`,
          fileName: `tts-${hashPayload(cachePayload)}.wav`,
        }
      );
      artifact.filePath = await this.persistArtifact(
        personality.id,
        artifact.fileName,
        wav
      );
      this.rememberArtifact('tts', personality.id, cachePayload, artifact);
      await this.log({
        kind: 'tts',
        personalityId: personality.id,
        summary: `Stub TTS generated for ${personality.id} via ${provider}.`,
      });
      this.finishTask(task.id, {
        status: 'completed',
        artifactId: artifact.id,
        provider,
        progressPct: 100,
        stage: 'completed',
      });
      return artifact;
    } catch (error) {
      this.finishTask(task.id, {
        status: 'failed',
        provider,
        error: error instanceof Error ? error.message : 'Unknown TTS error',
      });
      throw error;
    }
  }

  async transcribeSpeech(input = {}) {
    const personality = this.personalityManager.getPersonality(
      input.personalityId ?? 'default'
    );
    const audioBase64 = String(input.audioBase64 ?? '').trim();
    const mockTranscript = String(input.mockTranscript ?? '').trim();
    const provider = this.resolveProvider('stt', personality, input);

    if (this.sttApiUrl && audioBase64) {
      const response = await maybeCallJsonApi(this.sttApiUrl, {
        audioBase64,
        mimeType: input.mimeType ?? 'audio/wav',
        locale: personality.multimodal?.sttLocale,
        personalityId: personality.id,
      });
      const payload = await response.json();
      await this.log({
        kind: 'stt',
        personalityId: personality.id,
        summary: `Remote STT completed for ${personality.id}.`,
      });
      return {
        personalityId: personality.id,
        transcript: payload.transcript ?? '',
        provider,
        mode: 'remote',
      };
    }

    const transcript =
      mockTranscript ||
      (audioBase64
        ? `Распознана заглушка речи для ${personality.displayName}. Длина аудио: ${Math.round(audioBase64.length / 4)} байт.`
        : `Заглушка распознавания для ${personality.displayName}: передай audioBase64 или mockTranscript.`);
    await this.log({
      kind: 'stt',
      personalityId: personality.id,
      summary: `Stub STT completed for ${personality.id}.`,
    });
    return {
      personalityId: personality.id,
      transcript,
      provider,
      mode: 'stub',
    };
  }

  async generateImage(input = {}) {
    const personality = this.personalityManager.getPersonality(
      input.personalityId ?? 'default'
    );
    const prompt =
      String(input.prompt ?? '').trim() ||
      personality.multimodal?.avatarPrompt ||
      personality.displayName;
    const provider = this.resolveProvider('image', personality, input);
    const style = this.resolveStyle(personality, input);
    const shapedPrompt = this.shapeImagePrompt(prompt, personality, style);

    const cachePayload = {
      prompt,
      shapedPrompt,
      provider,
      style: personality.multimodal?.imageStyle,
      styleTone: style.imageTone,
      palette: style.palette,
      emotion: personality.dynamicState?.lastEmotion,
      profileDescription: personality.profileDescription,
    };
    const cached = await this.getCachedArtifact(
      'image',
      personality.id,
      cachePayload
    );

    if (cached) {
      await this.log({
        kind: 'image-cache',
        personalityId: personality.id,
        summary: `Cached image reused for ${personality.id}.`,
      });
      return cached;
    }

    const task = this.startTask('image', personality.id, {
      prompt,
      provider,
      stage: 'prompt-shaping',
      progressPct: 16,
    });

    try {
      if (this.imageApiUrl) {
        const response = await maybeCallJsonApi(this.imageApiUrl, {
          prompt,
          shapedPrompt,
          personalityId: personality.id,
          provider,
          style: personality.multimodal?.imageStyle,
          styleProfile: style,
        });
        const payload = await response.json();
        const raw = Buffer.from(String(payload.imageBase64 ?? ''), 'base64');
        const artifact = this.buildArtifact(
          personality.id,
          'image',
          payload.mimeType ?? 'image/png',
          raw,
          {
            extension: 'png',
            provider,
            mode: 'remote',
            previewText: prompt,
            prompt: shapedPrompt,
            fileName: `image-${hashPayload(cachePayload)}.png`,
          }
        );
        artifact.filePath = await this.persistArtifact(
          personality.id,
          artifact.fileName,
          raw
        );
        this.rememberArtifact('image', personality.id, cachePayload, artifact);
        await this.log({
          kind: 'image-generate',
          personalityId: personality.id,
          summary: `Remote image generated for ${personality.id} via ${provider}.`,
        });
        this.finishTask(task.id, {
          status: 'completed',
          artifactId: artifact.id,
          provider,
          progressPct: 100,
          stage: 'completed',
        });
        return artifact;
      }

      const svg = createSvgCard({
        title: personality.displayName,
        subtitle:
          [personality.multimodal?.imageStyle, style.imageTone]
            .filter(Boolean)
            .join(' | ') || 'visual personality card',
        body: `${shapedPrompt}\n${personality.profileDescription ?? ''}`,
        accent:
          personality.dynamicState?.lastEmotion === 'guarded'
            ? '#ffb37c'
            : '#7cc6ff',
        background:
          personality.dynamicState?.lastEmotion === 'bright'
            ? '#123652'
            : '#102034',
      });
      const artifact = this.buildArtifact(
        personality.id,
        'image',
        'image/svg+xml',
        svg,
        {
          extension: 'svg',
          provider,
          mode: 'stub',
          previewText: prompt,
          prompt: shapedPrompt,
          description: `Visual stub for ${personality.displayName} in ${personality.multimodal?.imageStyle} with palette ${buildPaletteText(style.palette) ?? 'default'}.`,
          fileName: `image-${hashPayload(cachePayload)}.svg`,
        }
      );
      artifact.filePath = await this.persistArtifact(
        personality.id,
        artifact.fileName,
        svg
      );
      this.rememberArtifact('image', personality.id, cachePayload, artifact);
      await this.log({
        kind: 'image-generate',
        personalityId: personality.id,
        summary: `Stub image generated for ${personality.id} via ${provider}.`,
      });
      this.finishTask(task.id, {
        status: 'completed',
        artifactId: artifact.id,
        provider,
        progressPct: 100,
        stage: 'completed',
      });
      return artifact;
    } catch (error) {
      this.finishTask(task.id, {
        status: 'failed',
        provider,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown image generation error',
      });
      throw error;
    }
  }

  async describeImage(input = {}) {
    const personality = this.personalityManager.getPersonality(
      input.personalityId ?? 'default'
    );
    const prompt = String(input.prompt ?? '').trim();
    const binary = summarizeBinaryInput(input);

    if (this.imageApiUrl && binary.hasUpload) {
      const response = await maybeCallJsonApi(this.imageApiUrl, {
        mode: 'describe',
        personalityId: personality.id,
        prompt,
        dataBase64: binary.dataBase64,
        mimeType: binary.mimeType,
        fileName: binary.fileName,
        style: personality.multimodal?.imageStyle,
      });
      const payload = await response.json();
      const description =
        String(payload.description ?? '').trim() ||
        `${personality.displayName} processed uploaded image.`;
      await this.log({
        kind: 'image-describe',
        personalityId: personality.id,
        summary: `Remote image description generated for ${personality.id}.`,
      });
      return {
        personalityId: personality.id,
        provider: 'remote-image-describer',
        mode: 'remote',
        description,
        source: {
          mimeType: binary.mimeType,
          fileName: binary.fileName,
          approxBytes: binary.approxBytes,
        },
      };
    }

    const description = [
      `${personality.displayName} видит образ в стиле ${personality.multimodal?.imageStyle ?? 'unknown-style'}.`,
      binary.hasUpload
        ? `Загружен файл ${binary.fileName ?? 'without-name'} (${binary.mimeType}, около ${binary.approxBytes} байт).`
        : 'Файл изображения не передан.',
      prompt
        ? `Похоже, что в центре сцены: ${prompt}.`
        : 'Промпт не передан, поэтому описание строится по профилю личности.',
      `Эмоциональный фон: ${personality.dynamicState?.lastEmotion ?? 'neutral'}.`,
    ].join(' ');
    await this.log({
      kind: 'image-describe',
      personalityId: personality.id,
      summary: `Image description generated for ${personality.id}.`,
    });
    return {
      personalityId: personality.id,
      provider: this.imageApiUrl
        ? 'remote-image-describer'
        : 'stub-image-describer',
      mode: this.imageApiUrl ? 'remote' : 'stub',
      description,
      source: binary.hasUpload
        ? {
            mimeType: binary.mimeType,
            fileName: binary.fileName,
            approxBytes: binary.approxBytes,
          }
        : null,
    };
  }

  async generateVideo(input = {}) {
    const personality = this.personalityManager.getPersonality(
      input.personalityId ?? 'default'
    );
    const prompt =
      String(input.prompt ?? '').trim() ||
      `${personality.displayName} shares a short emotional scene`;
    const durationSeconds = Math.max(
      2,
      Math.min(12, Number(input.durationSeconds ?? 4))
    );
    const provider = this.resolveProvider('video', personality, input);
    const style = this.resolveStyle(personality, input);
    const shapedPrompt = this.shapeVideoPrompt(
      prompt,
      personality,
      style,
      durationSeconds
    );

    const cachePayload = {
      prompt,
      shapedPrompt,
      provider,
      durationSeconds,
      style: personality.multimodal?.videoStyle,
      palette: style.palette,
      music: style.music,
      emotion: personality.dynamicState?.lastEmotion,
    };
    const cached = await this.getCachedArtifact(
      'video',
      personality.id,
      cachePayload
    );

    if (cached) {
      await this.log({
        kind: 'video-cache',
        personalityId: personality.id,
        summary: `Cached video reused for ${personality.id}.`,
      });
      return cached;
    }

    const task = this.startTask('video', personality.id, {
      prompt,
      provider,
      stage: 'storyboarding',
      progressPct: 14,
    });

    try {
      if (this.videoExecutor) {
        const result = await this.videoExecutor({
          personality: {
            id: personality.id,
            displayName: personality.displayName,
            profileDescription: personality.profileDescription ?? null,
            multimodal: {
              videoStyle: personality.multimodal?.videoStyle ?? null,
            },
            dynamicState: {
              lastEmotion: personality.dynamicState?.lastEmotion ?? null,
            },
          },
          prompt,
          shapedPrompt,
          provider,
          durationSeconds,
          style,
          videoApiUrl: this.videoApiUrl,
          cacheKey: `video-${hashPayload(cachePayload)}`,
          sandboxDelayMs: Number(input.sandboxDelayMs ?? 0),
        });
        const raw = Buffer.from(String(result.dataBase64 ?? ''), 'base64');
        const artifact = this.buildArtifact(
          personality.id,
          'video',
          result.mimeType ?? 'application/octet-stream',
          raw,
          {
            extension: result.extension ?? 'bin',
            provider: result.provider ?? provider,
            mode: result.mode ?? 'sandbox',
            previewText: result.previewText ?? prompt,
            prompt: result.prompt ?? shapedPrompt,
            description: result.description ?? null,
            fileName:
              result.fileName ??
              `video-${hashPayload(cachePayload)}.${result.extension ?? 'bin'}`,
          }
        );
        artifact.filePath = await this.persistArtifact(
          personality.id,
          artifact.fileName,
          raw
        );
        this.rememberArtifact('video', personality.id, cachePayload, artifact);
        await this.log({
          kind: 'video-generate',
          personalityId: personality.id,
          summary: `Sandbox video generated for ${personality.id} via ${provider}.`,
        });
        this.finishTask(task.id, {
          status: 'completed',
          artifactId: artifact.id,
          provider,
          progressPct: 100,
          stage: 'completed',
        });
        return artifact;
      }

      if (this.videoApiUrl) {
        const response = await maybeCallJsonApi(this.videoApiUrl, {
          prompt,
          shapedPrompt,
          personalityId: personality.id,
          provider,
          style: personality.multimodal?.videoStyle,
          styleProfile: style,
          durationSeconds,
        });
        const payload = await response.json();
        const raw = Buffer.from(String(payload.videoBase64 ?? ''), 'base64');
        const artifact = this.buildArtifact(
          personality.id,
          'video',
          payload.mimeType ?? 'video/mp4',
          raw,
          {
            extension: 'mp4',
            provider,
            mode: 'remote',
            previewText: prompt,
            prompt: shapedPrompt,
            fileName: `video-${hashPayload(cachePayload)}.mp4`,
          }
        );
        artifact.filePath = await this.persistArtifact(
          personality.id,
          artifact.fileName,
          raw
        );
        this.rememberArtifact('video', personality.id, cachePayload, artifact);
        await this.log({
          kind: 'video-generate',
          personalityId: personality.id,
          summary: `Remote video generated for ${personality.id} via ${provider}.`,
        });
        this.finishTask(task.id, {
          status: 'completed',
          artifactId: artifact.id,
          provider,
          progressPct: 100,
          stage: 'completed',
        });
        return artifact;
      }

      const storyboard = {
        title: `${personality.displayName} storyboard`,
        durationSeconds,
        style: personality.multimodal?.videoStyle,
        provider,
        palette: style.palette,
        music: style.music,
        frames: Array.from(
          { length: Math.min(6, durationSeconds + 1) },
          (_, index) => ({
            t: index,
            caption: `${personality.displayName} frame ${index + 1}: ${shapedPrompt}`,
            emotion: personality.dynamicState?.lastEmotion,
          })
        ),
      };
      const raw = Buffer.from(JSON.stringify(storyboard, null, 2), 'utf8');
      const artifact = this.buildArtifact(
        personality.id,
        'video',
        'application/json',
        raw,
        {
          extension: 'json',
          provider,
          mode: 'stub',
          previewText: prompt,
          prompt: shapedPrompt,
          description: `Storyboard stub for ${personality.displayName} in ${personality.multimodal?.videoStyle} with ${style.music?.genre ?? 'ambient'} pacing.`,
          fileName: `video-${hashPayload(cachePayload)}.json`,
        }
      );
      artifact.filePath = await this.persistArtifact(
        personality.id,
        artifact.fileName,
        raw
      );
      this.rememberArtifact('video', personality.id, cachePayload, artifact);
      await this.log({
        kind: 'video-generate',
        personalityId: personality.id,
        summary: `Stub video storyboard generated for ${personality.id} via ${provider}.`,
      });
      this.finishTask(task.id, {
        status: 'completed',
        artifactId: artifact.id,
        provider,
        progressPct: 100,
        stage: 'completed',
      });
      return artifact;
    } catch (error) {
      this.finishTask(task.id, {
        status: 'failed',
        provider,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown video generation error',
      });
      throw error;
    }
  }

  async describeVideo(input = {}) {
    const personality = this.personalityManager.getPersonality(
      input.personalityId ?? 'default'
    );
    const prompt = String(input.prompt ?? '').trim();
    const binary = summarizeBinaryInput(input);

    if (this.videoApiUrl && binary.hasUpload) {
      const response = await maybeCallJsonApi(this.videoApiUrl, {
        mode: 'describe',
        personalityId: personality.id,
        prompt,
        dataBase64: binary.dataBase64,
        mimeType: binary.mimeType,
        fileName: binary.fileName,
        style: personality.multimodal?.videoStyle,
      });
      const payload = await response.json();
      const description =
        String(payload.description ?? '').trim() ||
        `${personality.displayName} processed uploaded video.`;
      await this.log({
        kind: 'video-describe',
        personalityId: personality.id,
        summary: `Remote video description generated for ${personality.id}.`,
      });
      return {
        personalityId: personality.id,
        provider: 'remote-video-describer',
        mode: 'remote',
        description,
        source: {
          mimeType: binary.mimeType,
          fileName: binary.fileName,
          approxBytes: binary.approxBytes,
        },
      };
    }

    const description = [
      `${personality.displayName} воспринимает видео как короткую сцену в стиле ${personality.multimodal?.videoStyle ?? 'storyboard'}.`,
      binary.hasUpload
        ? `Загружен файл ${binary.fileName ?? 'without-name'} (${binary.mimeType}, около ${binary.approxBytes} байт).`
        : 'Видео-файл не передан.',
      prompt
        ? `Содержание похоже на: ${prompt}.`
        : 'Описание строится по визуальному стилю и текущему настроению личности.',
      `Психологический оттенок: ${personality.profileDescription ?? personality.characterSummary}.`,
    ].join(' ');
    await this.log({
      kind: 'video-describe',
      personalityId: personality.id,
      summary: `Video description generated for ${personality.id}.`,
    });
    return {
      personalityId: personality.id,
      provider: this.videoApiUrl
        ? 'remote-video-describer'
        : 'stub-video-describer',
      mode: this.videoApiUrl ? 'remote' : 'stub',
      description,
      source: binary.hasUpload
        ? {
            mimeType: binary.mimeType,
            fileName: binary.fileName,
            approxBytes: binary.approxBytes,
          }
        : null,
    };
  }
}
