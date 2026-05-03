import { executeVideoSandboxTask } from './video-task.mjs';

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

process.on('message', async (message) => {
  if (!message || message.type !== 'request') {
    return;
  }

  try {
    if (message.action !== 'generate-video') {
      throw new Error(`Unsupported video sandbox action: ${message.action}`);
    }

    const result = await executeVideoSandboxTask(message.payload ?? {});
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
  process.exit(0);
});
