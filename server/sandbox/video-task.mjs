function toText(value) {
  return String(value ?? '').trim();
}

function encodeBase64(value) {
  return Buffer.isBuffer(value)
    ? value.toString('base64')
    : Buffer.from(String(value ?? ''), 'utf8').toString('base64');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function executeVideoSandboxTask(input = {}) {
  const personality = input.personality ?? {};
  const prompt =
    toText(input.prompt) ||
    `${personality.displayName ?? personality.id ?? 'Unknown'} shares a short emotional scene`;
  const shapedPrompt = toText(input.shapedPrompt) || prompt;
  const provider = toText(input.provider) || 'storyboard';
  const durationSeconds = Math.max(
    2,
    Math.min(12, Number(input.durationSeconds ?? 4))
  );
  const cacheKey = toText(input.cacheKey) || `video-${Date.now()}`;
  const style = input.style ?? {};
  const sandboxDelayMs = Math.max(0, Number(input.sandboxDelayMs ?? 0));

  if (sandboxDelayMs > 0) {
    await sleep(sandboxDelayMs);
  }

  if (input.videoApiUrl) {
    const response = await maybeCallJsonApi(input.videoApiUrl, {
      prompt,
      shapedPrompt,
      personalityId: personality.id,
      provider,
      style: personality.multimodal?.videoStyle,
      styleProfile: style,
      durationSeconds,
    });
    const payload = await response.json();
    return {
      mimeType: payload.mimeType ?? 'video/mp4',
      dataBase64: String(payload.videoBase64 ?? ''),
      extension: 'mp4',
      provider,
      mode: 'remote-sandbox',
      previewText: prompt,
      prompt: shapedPrompt,
      fileName: `${cacheKey}.mp4`,
      description: payload.description ?? null,
    };
  }

  const storyboard = {
    title: `${personality.displayName ?? personality.id ?? 'Unknown'} storyboard`,
    durationSeconds,
    style: personality.multimodal?.videoStyle ?? null,
    provider,
    palette: Array.isArray(style.palette) ? style.palette : [],
    music: style.music ?? null,
    frames: Array.from(
      { length: Math.min(6, durationSeconds + 1) },
      (_, index) => ({
        t: index,
        caption: `${personality.displayName ?? personality.id ?? 'Unknown'} frame ${index + 1}: ${shapedPrompt}`,
        emotion: personality.dynamicState?.lastEmotion ?? null,
      })
    ),
  };
  const raw = Buffer.from(JSON.stringify(storyboard, null, 2), 'utf8');

  return {
    mimeType: 'application/json',
    dataBase64: encodeBase64(raw),
    extension: 'json',
    provider,
    mode: 'sandbox-stub',
    previewText: prompt,
    prompt: shapedPrompt,
    fileName: `${cacheKey}.json`,
    description: `Storyboard stub for ${personality.displayName ?? personality.id ?? 'unknown'} in ${personality.multimodal?.videoStyle ?? 'storyboard'} with ${style.music?.genre ?? 'ambient'} pacing.`,
  };
}
