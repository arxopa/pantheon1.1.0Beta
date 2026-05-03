import { PantheonNetSurfer } from '../navigation/pantheon-net-surfer.mjs';

const netSurfer = new PantheonNetSurfer();

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    name: 'Error',
    message: String(error ?? 'Unknown error'),
    stack: null,
  };
}

async function shutdown() {
  const activePersonalities = netSurfer.getStatus().activePersonalities ?? [];

  for (const personalityId of activePersonalities) {
    await netSurfer.stop({ personalityId }).catch(() => {});
  }
}

async function handleRequest(action, payload = {}) {
  if (action === 'prewarm') {
    const installed = await netSurfer.prewarm();
    return {
      installed,
      status: netSurfer.getStatus(),
    };
  }

  if (action === 'status') {
    return netSurfer.getStatus();
  }

  if (action === 'snapshot') {
    return netSurfer.snapshot(payload);
  }

  if (action === 'logs') {
    return {
      logs: netSurfer.getLogs(Number(payload.limit ?? 60)),
    };
  }

  if (action === 'navigate') {
    return netSurfer.navigate(payload);
  }

  if (action === 'search') {
    return netSurfer.search(payload);
  }

  if (action === 'click') {
    return netSurfer.click(payload);
  }

  if (action === 'type') {
    return netSurfer.typeText(payload);
  }

  if (action === 'scroll') {
    return netSurfer.scroll(payload);
  }

  throw new Error(`Unsupported browser sandbox action: ${action}`);
}

process.on('message', async (message) => {
  if (!message || message.type !== 'request') {
    return;
  }

  try {
    const result = await handleRequest(message.action, message.payload ?? {});
    process.send?.({
      type: 'response',
      requestId: message.requestId,
      ok: true,
      result,
    });
  } catch (error) {
    process.send?.({
      type: 'response',
      requestId: message.requestId,
      ok: false,
      error: serializeError(error),
    });
  }
});

process.on('disconnect', () => {
  shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});
