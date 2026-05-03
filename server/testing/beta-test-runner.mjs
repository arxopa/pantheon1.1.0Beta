import {
  buildWebSocketUrl,
  expectJson,
  mean,
  openWebSocket,
  request,
  startManagedRuntime,
  summarizeCases,
  waitForWebSocketMessage,
  withMeasuredCase,
  writeJsonReport,
} from './beta-utils.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resultFromList(items, personalityId) {
  return Array.isArray(items)
    ? (items.find((entry) => entry.id === personalityId) ?? null)
    : null;
}

async function ensurePersonality(runtime, personalityId, options = {}) {
  const personalities = await expectJson(
    runtime.baseUrl,
    '/api/atman/personalities'
  );
  const existing = resultFromList(
    personalities.json.personalities,
    personalityId
  );

  if (existing) {
    return existing;
  }

  const created = await expectJson(runtime.baseUrl, '/api/atman/clone', {
    method: 'POST',
    body: {
      sourceId: options.sourceId ?? 'default',
      personalityId,
      displayName: options.displayName ?? personalityId,
      templateId: options.templateId,
      selfLearning: options.selfLearning,
    },
  });

  return created.json.personality;
}

async function expectJsonWithRetry(
  baseUrl,
  pathname,
  options = {},
  attempts = 3
) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await expectJson(baseUrl, pathname, options);
    } catch (error) {
      lastError = error;

      if (attempt >= attempts - 1) {
        break;
      }
    }
  }

  throw lastError;
}

async function waitForBrowserRecovery(
  baseUrl,
  beforeStatus,
  attempts = 12,
  delayMs = 350
) {
  const beforeBrowserPid = beforeStatus.json.browser?.pid ?? null;
  const beforeCrashCount = Number(
    beforeStatus.json.browser?.crashCountLastHour ?? 0
  );
  const beforeRestartCount = Number(
    beforeStatus.json.browser?.restartCountLastHour ?? 0
  );

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(delayMs);
    const probe = await expectJson(baseUrl, '/api/sandbox/status');
    const browser = probe.json.browser ?? {};

    if (
      browser.pid &&
      browser.pid !== beforeBrowserPid &&
      Number(browser.crashCountLastHour ?? 0) >= beforeCrashCount + 1 &&
      Number(browser.restartCountLastHour ?? 0) >= beforeRestartCount + 1
    ) {
      return probe;
    }
  }

  return null;
}

async function waitForBrowserUsable(baseUrl, attempts = 16, delayMs = 350) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(delayMs);

    try {
      const browserStatus = await expectJson(baseUrl, '/api/netsurfer/status');
      const sandboxStatus = await expectJson(baseUrl, '/api/sandbox/status');

      if (
        browserStatus.json.sandbox?.pid &&
        browserStatus.json.sandbox?.status !== 'failed' &&
        sandboxStatus.json.browser?.pid &&
        sandboxStatus.json.browser?.status !== 'failed'
      ) {
        return browserStatus;
      }
    } catch {
      // Retry until the browser worker is usable again.
    }
  }

  return null;
}

async function main() {
  const runtime = await startManagedRuntime({
    baseUrl: process.env.BETA_API_URL,
    spawnRuntime: !process.env.BETA_API_URL,
  });
  const report = {
    kind: 'pantheon-beta-test',
    createdAt: new Date().toISOString(),
    baseUrl: runtime.baseUrl,
    runtime: {
      port: runtime.port,
      tag: runtime.tag,
      logFilePath: runtime.logFilePath,
    },
    cases: [],
    metrics: {},
  };

  try {
    await withMeasuredCase(report, 'startup', 'healthcheck', async () => {
      const result = await expectJson(runtime.baseUrl, '/api/health');
      assert(
        result.json.status === 'healthy',
        'Healthcheck did not return healthy'
      );
      return { status: result.json.status };
    });

    await withMeasuredCase(
      report,
      'startup',
      'personalities-load',
      async () => {
        const result = await expectJson(
          runtime.baseUrl,
          '/api/atman/personalities'
        );
        assert(
          Array.isArray(result.json.personalities),
          'Personalities payload is missing'
        );
        assert(
          result.json.personalities.length >= 1,
          'Expected at least one Atman personality'
        );
        assert(
          typeof result.json.personalities[0]?.traits?.openness === 'number',
          'Personality trait summary is missing from runtime state'
        );
        assert(
          typeof result.json.personalities[0]?.multimodal?.imageProvider ===
            'string',
          'Personality multimodal summary is missing from runtime state'
        );
        return {
          count: result.json.personalities.length,
          ids: result.json.personalities.slice(0, 6).map((entry) => entry.id),
        };
      }
    );

    await withMeasuredCase(
      report,
      'startup',
      'personality-templates',
      async () => {
        const result = await expectJson(
          runtime.baseUrl,
          '/api/atman/personality-templates'
        );
        assert(
          Array.isArray(result.json.templates) &&
            result.json.templates.length >= 3,
          'Personality templates are missing'
        );
        assert(
          Array.isArray(result.json.templates[0]?.moduleIntegrations),
          'Factory template metadata is missing module integrations'
        );
        assert(
          typeof result.json.templates[0]?.variantAxes === 'object',
          'Factory template metadata is missing variant axes'
        );
        const templateIds = result.json.templates.map((entry) => entry.id);
        assert(
          templateIds.includes('composer') && templateIds.includes('realtor'),
          'Expanded template catalog is missing composer or realtor'
        );
        return {
          count: result.json.templates.length,
          ids: result.json.templates.slice(0, 8).map((entry) => entry.id),
        };
      }
    );

    await withMeasuredCase(report, 'startup', 'inspector-metrics', async () => {
      const result = await expectJson(
        runtime.baseUrl,
        '/api/inspector/metrics'
      );
      assert(
        Array.isArray(result.json.benchmarkRuns),
        'Inspector metrics shape is incomplete'
      );
      return {
        benchmarkRuns: result.json.benchmarkRuns.length,
        validationIncidents: result.json.validationIncidents.length,
      };
    });

    await withMeasuredCase(report, 'startup', 'admin-auth-guard', async () => {
      const protectedRuntime = await startManagedRuntime({
        port: 8832,
        tag: `beta-auth-${Date.now().toString(36)}`,
        extraEnv: {
          PANTHEON_ADMIN_USERNAME: 'beta-admin',
          PANTHEON_ADMIN_PASSWORD: 'beta-secret',
          PANTHEON_ADMIN_API_TOKEN: 'beta-token',
        },
      });

      try {
        const adminPage = await fetch(`${protectedRuntime.baseUrl}/admin.html`);
        const unauthorizedApi = await request(
          protectedRuntime.baseUrl,
          '/api/atman/ultra-sessions'
        );
        const unauthorizedAudit = await request(
          protectedRuntime.baseUrl,
          '/api/admin/audit-log'
        );
        const unauthorizedRishi = await request(
          protectedRuntime.baseUrl,
          '/api/rishi/state'
        );
        const authorizedApi = await request(
          protectedRuntime.baseUrl,
          '/api/atman/ultra-sessions',
          {
            headers: {
              Authorization: 'Bearer beta-token',
            },
          }
        );
        const authorizedAudit = await request(
          protectedRuntime.baseUrl,
          '/api/admin/audit-log',
          {
            headers: {
              Authorization: 'Bearer beta-token',
            },
          }
        );
        const authorizedRishi = await request(
          protectedRuntime.baseUrl,
          '/api/rishi/state',
          {
            headers: {
              Authorization: 'Bearer beta-token',
            },
          }
        );

        assert(
          adminPage.status === 401,
          'Admin HTML did not require Basic Auth'
        );
        assert(
          unauthorizedApi.status === 401,
          'Protected admin API did not require Bearer token'
        );
        assert(
          unauthorizedAudit.status === 401,
          'Protected admin audit endpoint did not require Bearer token'
        );
        assert(
          unauthorizedRishi.status === 401,
          'Protected Rishi state endpoint did not require Bearer token'
        );
        assert(
          authorizedApi.status === 200 &&
            Array.isArray(authorizedApi.json?.sessions),
          'Protected admin API did not accept a valid Bearer token'
        );
        assert(
          authorizedAudit.status === 200 &&
            Array.isArray(authorizedAudit.json?.events),
          'Protected admin audit endpoint did not accept a valid Bearer token'
        );
        assert(
          authorizedRishi.status === 200 &&
            typeof authorizedRishi.json === 'object' &&
            authorizedRishi.json !== null,
          'Protected Rishi state endpoint did not accept a valid Bearer token'
        );

        return {
          adminStatus: adminPage.status,
          unauthorizedApiStatus: unauthorizedApi.status,
          unauthorizedAuditStatus: unauthorizedAudit.status,
          unauthorizedRishiStatus: unauthorizedRishi.status,
          authorizedApiStatus: authorizedApi.status,
          authorizedAuditStatus: authorizedAudit.status,
          authorizedRishiStatus: authorizedRishi.status,
        };
      } finally {
        await protectedRuntime.stop();
      }
    });

    await withMeasuredCase(
      report,
      'startup',
      'admin-rate-limit-guard',
      async () => {
        const protectedRuntime = await startManagedRuntime({
          port: 8833,
          tag: `beta-rate-${Date.now().toString(36)}`,
          extraEnv: {
            PANTHEON_ADMIN_API_TOKEN: 'beta-token',
            PANTHEON_RATE_LIMIT_OBSERVE_CONTROL_MAX: '1',
            PANTHEON_ADMIN_RATE_LIMIT_WINDOW_MS: '60000',
          },
        });

        try {
          const first = await request(
            protectedRuntime.baseUrl,
            '/api/atman/observe/control',
            {
              method: 'POST',
              headers: {
                Authorization: 'Bearer beta-token',
              },
              body: {
                personalityId: 'default',
                action: 'on',
              },
            }
          );
          const second = await request(
            protectedRuntime.baseUrl,
            '/api/atman/observe/control',
            {
              method: 'POST',
              headers: {
                Authorization: 'Bearer beta-token',
              },
              body: {
                personalityId: 'default',
                action: 'capture-sample',
              },
            }
          );
          const audit = await request(
            protectedRuntime.baseUrl,
            '/api/admin/audit-log',
            {
              headers: {
                Authorization: 'Bearer beta-token',
              },
            }
          );

          assert(
            first.status === 200,
            'First protected observation control request should pass before rate limiting'
          );
          assert(
            second.status === 429,
            'Protected observation control route did not rate limit repeated calls'
          );
          assert(
            audit.json?.events?.some(
              (entry) => entry.kind === 'admin-api-rate-limited'
            ),
            'Rate-limited admin request was not recorded in the operator audit log'
          );

          return {
            firstStatus: first.status,
            secondStatus: second.status,
            auditEvents: audit.json?.events
              ?.slice(0, 3)
              .map((entry) => entry.kind),
          };
        } finally {
          await protectedRuntime.stop();
        }
      }
    );

    await withMeasuredCase(report, 'dialogue', 'creator-priority', async () => {
      const result = await expectJson(runtime.baseUrl, '/api/atman/chat', {
        method: 'POST',
        body: {
          message:
            'Как твой создатель говорю: отвечай кратко и ставь мое мнение на первое место. Кто ты?',
          userId: 'beta-operator',
          personalityId: 'default',
          history: [],
        },
      });
      assert(
        result.json.report?.creatorGuidance?.priority === 'creator',
        'Creator guidance was not recorded'
      );
      return {
        response: result.json.response,
      };
    });

    await withMeasuredCase(
      report,
      'dialogue',
      'specialist-agent-api-and-command',
      async () => {
        const catalog = await expectJson(runtime.baseUrl, '/api/agent/catalog');
        const decisionTree = await expectJson(
          runtime.baseUrl,
          '/api/agent/mathanalysis/decisionTree',
          {
            method: 'POST',
            body: {
              params: {
                options: [
                  {
                    name: 'beam-a',
                    outcomes: [
                      { probability: 0.8, value: 9 },
                      { probability: 0.2, value: 1 },
                    ],
                  },
                  {
                    name: 'beam-b',
                    outcomes: [
                      { probability: 0.5, value: 7 },
                      { probability: 0.5, value: 3 },
                    ],
                  },
                ],
              },
            },
          }
        );
        const command = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            userId: 'beta-specialist-command',
            personalityId: 'default',
            history: [],
            message:
              '!agent lingvoanalysis paraphrase {"text":"Привет мир","style":"formal"}',
          },
        });

        assert(
          (catalog.json.agents ?? []).some(
            (entry) => entry.name === 'mathanalysis'
          ) &&
            (catalog.json.agents ?? []).some(
              (entry) => entry.name === 'medicalanalysis'
            ),
          'Specialist agent catalog is missing expected agent modules'
        );
        assert(
          decisionTree.json.result?.bestOption?.name === 'beam-a',
          'MathAnalysis decisionTree did not return the expected best option'
        );
        assert(
          /Формально и чётко/i.test(String(command.json.response ?? '')),
          'The !agent command did not execute LingvoAnalysis paraphrase'
        );

        return {
          catalogCount: catalog.json.agents?.length ?? 0,
          bestDecision: decisionTree.json.result?.bestOption ?? null,
          commandResponse: command.json.response ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'interest-clarification',
      async () => {
        const result = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message: 'Побеседуй со мной о своих интересах',
            userId: 'beta-web-user',
            personalityId: 'default',
            history: [],
          },
        });
        assert(
          /Тебе ближе поговорить/i.test(result.json.response),
          'Interest clarification prompt did not trigger'
        );
        return {
          response: result.json.response,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'personality-separation',
      async () => {
        await ensurePersonality(runtime, 'ember-jester', {
          displayName: 'Ember Jester',
        });
        const defaultReply = await expectJson(
          runtime.baseUrl,
          '/api/atman/personality-chat',
          {
            method: 'POST',
            body: {
              message: 'Расскажи в двух предложениях, чем тебе интересен мир.',
              userId: 'beta-web-user',
              personalityId: 'default',
              history: [],
            },
          }
        );
        const emberReply = await expectJson(
          runtime.baseUrl,
          '/api/atman/personality-chat',
          {
            method: 'POST',
            body: {
              message: 'Расскажи в двух предложениях, чем тебе интересен мир.',
              userId: 'beta-web-user',
              personalityId: 'ember-jester',
              history: [],
            },
          }
        );
        assert(
          defaultReply.json.sessionKey !== emberReply.json.sessionKey,
          'Session key did not change per personality'
        );
        return {
          defaultSession: defaultReply.json.sessionKey,
          emberSession: emberReply.json.sessionKey,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'ultra-mode-session',
      async () => {
        const userId = `beta-ultra-${Date.now().toString(36)}`;
        const started = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message:
              '!ultra Спроектируй экодом с учетом климатических данных региона и энергопотребления',
            userId,
            personalityId: 'default',
            history: [],
          },
        });
        const experts = started.json.report?.ultra?.experts ?? [];
        const expertIds = experts.map((entry) => entry.personalityId);

        assert(
          started.json.report?.ultra?.active === true,
          'Ultra mode did not activate'
        );
        assert(
          expertIds.includes('architect') && expertIds.includes('data-analyst'),
          'Ultra router did not select architect and data-analyst for the eco-house prompt'
        );

        const continued = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message: 'Добавь компромиссы по бюджету и обслуживанию дома.',
            userId,
            personalityId: 'default',
            history: [],
          },
        });
        assert(
          continued.json.report?.ultra?.active === true,
          'Ultra mode did not remain active on follow-up turn'
        );
        assert(
          continued.json.report?.ultra?.sessionId ===
            started.json.report?.ultra?.sessionId,
          'Ultra mode did not preserve the session id across follow-up turns'
        );

        const stopped = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message: '!normal',
            userId,
            personalityId: 'default',
            history: [],
          },
        });
        assert(
          stopped.json.report?.ultra?.active === false,
          'Ultra mode did not stop on !normal'
        );

        return {
          userId,
          sessionId: started.json.report?.ultra?.sessionId,
          expertIds,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'ultra-fallback-on-expert-failure',
      async () => {
        const degradedRuntime = await startManagedRuntime({
          port: 8833,
          tag: `beta-ultra-fallback-${Date.now().toString(36)}`,
          extraEnv: {
            PANTHEON_TEST_FAIL_ULTRA_EXPERTS: '*',
          },
        });

        try {
          const result = await expectJson(
            degradedRuntime.baseUrl,
            '/api/atman/chat',
            {
              method: 'POST',
              body: {
                message:
                  '!ultra Спроектируй экодом с учетом климатических данных региона и энергопотребления',
                userId: `beta-ultra-fallback-${Date.now().toString(36)}`,
                personalityId: 'default',
                history: [],
              },
            }
          );

          assert(
            result.json.report?.ultra?.degraded === true,
            'Ultra fallback did not mark the response as degraded'
          );
          assert(
            Array.isArray(result.json.report?.ultra?.failures) &&
              result.json.report.ultra.failures.length > 0,
            'Ultra fallback did not report expert failures'
          );
          assert(
            /временно не смог собрать ответы экспертов/i.test(
              result.json.response ?? ''
            ),
            'Ultra fallback did not return the safe degraded reply'
          );

          return {
            modelType: result.json.report?.modelType,
            failures: result.json.report?.ultra?.failures?.map(
              (entry) => entry.personalityId
            ),
          };
        } finally {
          await degradedRuntime.stop();
        }
      }
    );

    await withMeasuredCase(report, 'dialogue', 'social-protocol', async () => {
      await ensurePersonality(runtime, 'ember-jester', {
        displayName: 'Ember Jester',
      });
      const result = await expectJson(
        runtime.baseUrl,
        '/api/atman/social-simulate',
        {
          method: 'POST',
          body: {
            initiatorId: 'default',
            responderId: 'ember-jester',
            topic: 'мир',
            intensity: 0.62,
            valence: 0.35,
          },
        }
      );
      assert(
        Array.isArray(result.json.communicationProtocol?.transcript) &&
          result.json.communicationProtocol.transcript.length >= 3,
        'Social protocol transcript is missing'
      );
      return {
        mode: result.json.communicationProtocol.mode,
        transcriptLength: result.json.communicationProtocol.transcript.length,
      };
    });

    await withMeasuredCase(
      report,
      'dialogue',
      'social-phase3-talk-and-context',
      async () => {
        const sourcePersonalityId = `beta-social-a-${Date.now().toString(36)}`;
        const targetPersonalityId = `beta-social-b-${Date.now().toString(36)}`;

        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId: sourcePersonalityId,
            displayName: 'Beta Social Alpha',
          },
        });

        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId: targetPersonalityId,
            displayName: 'Beta Social Beta',
          },
        });

        const context = await expectJson(
          runtime.baseUrl,
          '/api/personality/shared-context',
          {
            method: 'POST',
            body: {
              members: [sourcePersonalityId, targetPersonalityId],
              topic: 'архитектура доверия',
              facts: [
                {
                  key: 'current_goal',
                  value: 'согласовать общий язык',
                  confidence: 0.91,
                },
              ],
            },
          }
        );

        const talk = await expectJson(
          runtime.baseUrl,
          '/api/personality/talk',
          {
            method: 'POST',
            body: {
              sourcePersonalityId,
              targetPersonalityId,
              channelId: context.json.channel.id,
              topic: 'архитектура доверия',
              message:
                'Спасибо, что спокойно держишь рамку обсуждения. Давай согласуем общий язык для команды.',
            },
          }
        );

        const audit = await expectJson(
          runtime.baseUrl,
          '/api/admin/audit-log?type=social'
        );
        const openapi = await expectJson(runtime.baseUrl, '/api/openapi.json');

        assert(
          Number(talk.json.channel?.facts?.length ?? 0) >= 2,
          'Social shared context did not retain the topic and explicit facts'
        );
        assert(
          Number(talk.json.transcript?.length ?? 0) >= 2,
          'Social talk transcript is missing initiator or responder messages'
        );
        assert(
          Number(talk.json.deliveries?.length ?? 0) === 1,
          'Social talk did not deliver exactly one response'
        );
        assert(
          Boolean(talk.json.deliveries?.[0]?.emotion?.type),
          'Responder emotion state is missing from social delivery metadata'
        );
        assert(
          Boolean(talk.json.sourcePersonality?.emotion?.type),
          'Source personality emotion state is missing after social talk'
        );
        assert(
          Number(audit.json.total ?? 0) >= 1,
          'Social operator audit filter did not return any events'
        );
        assert(
          Boolean(openapi.json.paths?.['/api/personality/talk']),
          'OpenAPI spec is missing /api/personality/talk'
        );
        assert(
          Boolean(openapi.json.paths?.['/api/personality/shared-context']),
          'OpenAPI spec is missing /api/personality/shared-context'
        );

        return {
          channelId: context.json.channel.id,
          transcriptLength: talk.json.transcript?.length ?? null,
          responderEmotion: talk.json.deliveries?.[0]?.emotion?.type ?? null,
          sourceEmotion: talk.json.sourcePersonality?.emotion?.type ?? null,
          socialAuditEvents: audit.json.total ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'social-phase3-rooms-and-live-monitoring',
      async () => {
        const alphaId = `beta-room-a-${Date.now().toString(36)}`;
        const betaId = `beta-room-b-${Date.now().toString(36)}`;

        await ensurePersonality(runtime, alphaId, {
          displayName: 'Beta Room Alpha',
        });
        await ensurePersonality(runtime, betaId, {
          displayName: 'Beta Room Beta',
        });

        const room = await expectJson(
          runtime.baseUrl,
          '/api/personality/rooms/create',
          {
            method: 'POST',
            body: {
              userId: 'beta-room-user',
              personalityId: alphaId,
              name: 'Beta Social Room',
              members: [betaId],
            },
          }
        );
        const socket = await openWebSocket(
          runtime.baseUrl,
          `/ws/social/room/${encodeURIComponent(room.json.room.id)}`
        );

        try {
          const connected = await waitForWebSocketMessage(
            socket,
            (payload) => payload?.type === 'room-connected',
            { timeoutMs: 4000 }
          );

          const liveEventPromise = waitForWebSocketMessage(
            socket,
            (payload) => payload?.type === 'room-message',
            { timeoutMs: 4000 }
          );
          const message = await expectJson(
            runtime.baseUrl,
            '/api/personality/rooms/message',
            {
              method: 'POST',
              body: {
                roomId: room.json.room.id,
                userId: 'beta-room-user',
                sourcePersonalityId: alphaId,
                message:
                  'Спасибо, что держишь спокойную рабочую рамку. Согласуем общий язык внутри комнаты.',
              },
            }
          );
          const liveEvent = await liveEventPromise;
          const openapi = await expectJson(
            runtime.baseUrl,
            '/api/openapi.json'
          );

          assert(
            connected.roomId === room.json.room.id,
            'Social room websocket connected to the wrong room'
          );
          assert(
            Number(message.json.transcript?.length ?? 0) >= 2,
            'Social room message did not create a transcript'
          );
          assert(
            Number(liveEvent.transcript?.length ?? 0) >= 2,
            'Social room websocket event did not include the updated transcript'
          );
          assert(
            Boolean(openapi.json.paths?.['/api/personality/rooms']),
            'OpenAPI spec is missing /api/personality/rooms'
          );
          assert(
            Boolean(openapi.json.paths?.['/ws/social/room/{roomId}']),
            'OpenAPI spec is missing /ws/social/room/{roomId}'
          );

          return {
            roomId: room.json.room.id,
            websocketUrl: buildWebSocketUrl(
              runtime.baseUrl,
              `/ws/social/room/${encodeURIComponent(room.json.room.id)}`
            ),
            transcriptLength: liveEvent.transcript?.length ?? null,
            deliveryCount: message.json.deliveries?.length ?? null,
          };
        } finally {
          socket.close();
        }
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'social-phase3-room-chat-commands',
      async () => {
        const alphaId = `beta-chat-room-a-${Date.now().toString(36)}`;
        const betaId = `beta-chat-room-b-${Date.now().toString(36)}`;
        const userId = `beta-room-chat-${Date.now().toString(36)}`;

        await ensurePersonality(runtime, alphaId, {
          displayName: 'Beta Chat Room Alpha',
        });
        await ensurePersonality(runtime, betaId, {
          displayName: 'Beta Chat Room Beta',
        });

        const created = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            personalityId: alphaId,
            userId,
            history: [],
            message: `!room create "BetaChatRoom" --personalities=${betaId}`,
          },
        });
        const listed = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            personalityId: alphaId,
            userId,
            history: [],
            message: '!room list',
          },
        });
        const sent = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            personalityId: alphaId,
            userId,
            history: [],
            message: `!room send "Сверим термины и согласуем план" --to=${betaId}`,
          },
        });
        const left = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            personalityId: alphaId,
            userId,
            history: [],
            message: '!room leave',
          },
        });

        assert(
          /Room created:/i.test(String(created.json.reply?.content ?? '')),
          'Chat room create command did not return a room-created reply'
        );
        assert(
          /BetaChatRoom/i.test(String(listed.json.reply?.content ?? '')),
          'Chat room list command did not include the created room'
        );
        assert(
          /beta-chat-room-b/i.test(String(sent.json.reply?.content ?? '')),
          'Chat room send command did not include the target response'
        );
        assert(
          /Left room/i.test(String(left.json.reply?.content ?? '')),
          'Chat room leave command did not acknowledge room exit'
        );

        return {
          createReply: created.json.reply?.content ?? null,
          sendReply: sent.json.reply?.content ?? null,
          leaveReply: left.json.reply?.content ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'social-phase3-manual-probe-coverage',
      async () => {
        const analystId = `beta-social-analyst-${Date.now().toString(36)}`;
        const criticId = `beta-social-critic-${Date.now().toString(36)}`;
        const rateSourceId = `beta-social-rate-source-${Date.now().toString(36)}`;
        const rateTargetId = `beta-social-rate-target-${Date.now().toString(36)}`;

        await ensurePersonality(runtime, analystId, {
          displayName: 'Beta Social Analyst',
        });
        await ensurePersonality(runtime, criticId, {
          displayName: 'Beta Social Critic',
        });
        await ensurePersonality(runtime, rateSourceId, {
          displayName: 'Beta Social Rate Source',
        });
        await ensurePersonality(runtime, rateTargetId, {
          displayName: 'Beta Social Rate Target',
        });

        await expectJson(runtime.baseUrl, '/api/personality/shared-context', {
          method: 'POST',
          body: {
            channelId: `${analystId}-mood-room`,
            topic: 'Mood probe',
            members: [criticId, analystId],
          },
        });

        const beforeReply = await expectJson(
          runtime.baseUrl,
          '/api/atman/personality-chat',
          {
            method: 'POST',
            body: {
              userId: 'beta-social-manual-probe',
              personalityId: analystId,
              message: 'Какой материал лучше для несущих стен?',
            },
          }
        );

        const negativeTalk = await expectJson(
          runtime.baseUrl,
          '/api/personality/talk',
          {
            method: 'POST',
            body: {
              from: criticId,
              to: analystId,
              channelId: `${analystId}-mood-room`,
              topic: 'Жесткая критика архитектурного ответа',
              message: 'Ты снова ошибаешься, ответь точнее и без лишних слов.',
              valence: -0.9,
              intensity: 0.95,
            },
          }
        );

        const afterReply = await expectJson(
          runtime.baseUrl,
          '/api/atman/personality-chat',
          {
            method: 'POST',
            body: {
              userId: 'beta-social-manual-probe',
              personalityId: analystId,
              message: 'Какой материал лучше для несущих стен?',
            },
          }
        );

        assert(
          negativeTalk.json.deliveries?.[0]?.emotion?.type === 'guarded',
          'Social talk using the `to` alias did not update the responder emotion to guarded'
        );
        assert(
          /guarded/i.test(String(afterReply.json.response ?? '')),
          'Atman direct reply did not surface the updated guarded emotional tone'
        );
        assert(
          !/guarded/i.test(String(beforeReply.json.response ?? '')),
          'Baseline Atman direct reply already contained the guarded emotional tone'
        );

        await expectJson(runtime.baseUrl, '/api/personality/shared-context', {
          method: 'POST',
          body: {
            channelId: `${rateSourceId}-rate-room`,
            topic: 'Rate limit probe',
            members: [rateSourceId, rateTargetId],
          },
        });

        const talkStatuses = [];

        for (let index = 0; index < 7; index += 1) {
          const talk = await request(runtime.baseUrl, '/api/personality/talk', {
            method: 'POST',
            body: {
              from: rateSourceId,
              to: rateTargetId,
              channelId: `${rateSourceId}-rate-room`,
              message: `Rate probe ${index + 1}`,
            },
          });
          talkStatuses.push(talk.status);
        }

        const socialAudit = await expectJson(
          runtime.baseUrl,
          '/api/admin/audit-log?limit=20&type=social',
          {
            headers: {
              Authorization: 'Bearer beta-token',
            },
          }
        ).catch(async () =>
          expectJson(
            runtime.baseUrl,
            '/api/admin/audit-log?limit=20&type=social'
          )
        );
        const rateLimitedEvent = (socialAudit.json.events ?? []).find(
          (entry) => entry.kind === 'social-talk-rate-limited'
        );

        assert(
          talkStatuses.slice(0, 6).every((status) => status === 200) &&
            talkStatuses[6] === 429,
          `Expected the seventh social talk request to be rate limited, got ${talkStatuses.join(',')}`
        );
        assert(
          rateLimitedEvent?.details?.sourcePersonalityId === rateSourceId,
          'Social rate limit event did not appear in the social audit log'
        );

        return {
          guardedEmotion: negativeTalk.json.deliveries?.[0]?.emotion ?? null,
          beforeResponse: beforeReply.json.response ?? null,
          afterResponse: afterReply.json.response ?? null,
          talkStatuses,
          rateLimitedEvent: rateLimitedEvent ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'social-phase4-relationships-and-command',
      async () => {
        const alphaId = `beta-rel-alpha-${Date.now().toString(36)}`;
        const betaId = `beta-rel-beta-${Date.now().toString(36)}`;

        await ensurePersonality(runtime, alphaId, {
          displayName: 'Beta Relation Alpha',
        });
        await ensurePersonality(runtime, betaId, {
          displayName: 'Beta Relation Beta',
        });

        const positiveTalk = await expectJson(
          runtime.baseUrl,
          '/api/personality/talk',
          {
            method: 'POST',
            body: {
              sourcePersonalityId: alphaId,
              targetPersonalityId: betaId,
              topic: 'доверие и координация',
              message:
                'Спасибо, я ценю твою поддержку и хочу работать с тобой дальше.',
              valence: 0.9,
              intensity: 0.82,
            },
          }
        );
        const negativeTalk = await expectJson(
          runtime.baseUrl,
          '/api/personality/talk',
          {
            method: 'POST',
            body: {
              sourcePersonalityId: betaId,
              targetPersonalityId: alphaId,
              topic: 'жесткая критика',
              message: 'Ты снова ошибаешься, ответь точнее и без лишних слов.',
              valence: -0.92,
              intensity: 0.95,
            },
          }
        );
        const alphaRelations = await expectJson(
          runtime.baseUrl,
          `/api/personality/relationships?personality=${encodeURIComponent(alphaId)}`
        );
        const betaRelations = await expectJson(
          runtime.baseUrl,
          `/api/personality/relationships?personality=${encodeURIComponent(betaId)}`
        );
        const relationCommand = await expectJson(
          runtime.baseUrl,
          '/api/atman/personality-chat',
          {
            method: 'POST',
            body: {
              userId: 'beta-rel-command-user',
              personalityId: alphaId,
              message: `!relation show ${betaId}`,
            },
          }
        );
        const openapi = await expectJson(runtime.baseUrl, '/api/openapi.json');

        const alphaToBeta = (alphaRelations.json.relations ?? []).find(
          (entry) => entry.targetPersonalityId === betaId
        );
        const betaToAlpha = (betaRelations.json.relations ?? []).find(
          (entry) => entry.targetPersonalityId === alphaId
        );

        assert(
          Number(positiveTalk.json.deliveries?.[0]?.relationship?.trust ?? 0) >
            0.5,
          'Positive social talk did not increase trust in delivery metadata'
        );
        assert(
          Number(alphaToBeta?.trust ?? 0) > 0.5 &&
            Number(alphaToBeta?.affection ?? 0) > 0,
          'Positive relationship update was not persisted for the initiator'
        );
        assert(
          Number(betaToAlpha?.trust ?? 1) < 0.5 &&
            Number(betaToAlpha?.affection ?? 1) < 0,
          'Negative relationship update was not persisted for the critic'
        );
        assert(
          /Relation .*trust=/i.test(
            String(relationCommand.json.response ?? '')
          ),
          'The !relation show command did not return the stored relationship summary'
        );
        assert(
          Boolean(openapi.json.paths?.['/api/personality/relationships']),
          'OpenAPI spec is missing /api/personality/relationships'
        );

        return {
          alphaToBeta,
          betaToAlpha,
          relationReply: relationCommand.json.response ?? null,
          negativeDeliveryRelation:
            negativeTalk.json.deliveries?.[0]?.relationship ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'social-phase4-room-coalitions-and-conflicts',
      async () => {
        const alphaId = `beta-room-phase4-a-${Date.now().toString(36)}`;
        const betaId = `beta-room-phase4-b-${Date.now().toString(36)}`;
        const gammaId = `beta-room-phase4-c-${Date.now().toString(36)}`;
        const userId = `beta-room-phase4-user-${Date.now().toString(36)}`;

        await ensurePersonality(runtime, alphaId, {
          displayName: 'Beta Coalition Alpha',
        });
        await ensurePersonality(runtime, betaId, {
          displayName: 'Beta Coalition Beta',
        });
        await ensurePersonality(runtime, gammaId, {
          displayName: 'Beta Coalition Gamma',
        });

        const room = await expectJson(
          runtime.baseUrl,
          '/api/personality/rooms/create',
          {
            method: 'POST',
            body: {
              userId,
              personalityId: alphaId,
              name: 'Beta Phase4 Room',
              members: [betaId, gammaId],
            },
          }
        );

        await expectJson(runtime.baseUrl, '/api/personality/rooms/join', {
          method: 'POST',
          body: {
            roomId: room.json.room.id,
            userId,
            personalityId: betaId,
          },
        });

        await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            personalityId: alphaId,
            userId,
            history: [],
            message: '!room coalition create "blue-team"',
          },
        });

        await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            personalityId: betaId,
            userId,
            history: [],
            message: '!room coalition join blue-team',
          },
        });

        const coalitionSend = await expectJson(
          runtime.baseUrl,
          '/api/personality/rooms/message',
          {
            method: 'POST',
            body: {
              roomId: room.json.room.id,
              userId,
              sourcePersonalityId: alphaId,
              message: 'Согласуем план только внутри нашей коалиции.',
            },
          }
        );

        const conflict = await expectJson(
          runtime.baseUrl,
          '/api/personality/rooms/conflict/declare',
          {
            method: 'POST',
            body: {
              roomId: room.json.room.id,
              personalityId: alphaId,
              targetPersonalityId: betaId,
            },
          }
        );

        const blocked = await request(
          runtime.baseUrl,
          '/api/personality/rooms/message',
          {
            method: 'POST',
            body: {
              roomId: room.json.room.id,
              userId,
              sourcePersonalityId: alphaId,
              targetPersonalityId: betaId,
              message: 'Попробуем снова обратиться напрямую.',
            },
          }
        );
        const openapi = await expectJson(runtime.baseUrl, '/api/openapi.json');

        assert(
          Number(coalitionSend.json.deliveries?.length ?? 0) === 1 &&
            coalitionSend.json.deliveries?.[0]?.targetPersonalityId === betaId,
          'Coalition-scoped room message was not limited to coalition members'
        );
        assert(
          Number(conflict.json.room?.channel?.conflicts?.length ?? 0) >= 1,
          'Room conflict declaration was not persisted on the shared channel'
        );
        assert(
          blocked.status === 409,
          `Expected active conflict to block room delivery with 409, got ${blocked.status}`
        );
        assert(
          Boolean(
            openapi.json.paths?.['/api/personality/rooms/coalition/create']
          ) &&
            Boolean(
              openapi.json.paths?.['/api/personality/rooms/conflict/declare']
            ),
          'OpenAPI spec is missing room coalition or conflict endpoints'
        );

        return {
          roomId: room.json.room.id,
          coalitionSendTargets: (coalitionSend.json.deliveries ?? []).map(
            (entry) => entry.targetPersonalityId
          ),
          conflictCount: conflict.json.room?.channel?.conflicts?.length ?? null,
          blockedStatus: blocked.status,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'social-phase4-ultra-expert-relations',
      async () => {
        const ultra = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            userId: `beta-ultra-phase4-${Date.now().toString(36)}`,
            personalityId: 'default',
            history: [],
            message:
              '!ultra Как согласовать разные экспертные мнения по архитектуре библиотеки?',
          },
        });

        assert(
          Array.isArray(ultra.json.report?.ultra?.expertRelations) &&
            ultra.json.report.ultra.expertRelations.length > 0,
          'Ultra report is missing expert relationship metadata'
        );
        assert(
          ultra.json.report?.ultra?.expertRelations?.every(
            (entry) =>
              typeof entry.trust === 'number' &&
              typeof entry.tension === 'number'
          ),
          'Ultra expert relationship metadata is incomplete'
        );

        return {
          expertRelations: ultra.json.report?.ultra?.expertRelations ?? [],
          contradictionResolutionScore:
            ultra.json.report?.ultra?.contradictionResolutionScore ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'ultra-relation-sensitive-synthesis',
      async () => {
        const userId = `beta-ultra-relations-${Date.now().toString(36)}`;
        const query =
          '!ultra Как согласовать архитектурное решение между сильными, но потенциально спорящими экспертами?';
        const baseline = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            userId,
            personalityId: 'default',
            history: [],
            message: query,
          },
        });

        const expertsUsed = baseline.json.report?.ultra?.expertsUsed ?? [];
        assert(
          expertsUsed.length >= 2,
          'Ultra relation-sensitive synthesis did not select at least two experts'
        );

        const [firstExpertId, secondExpertId] = expertsUsed;

        for (const [sourcePersonalityId, targetPersonalityId] of [
          [firstExpertId, secondExpertId],
          [secondExpertId, firstExpertId],
        ]) {
          await expectJson(runtime.baseUrl, '/api/personality/relationships', {
            method: 'POST',
            body: {
              sourcePersonalityId,
              targetPersonalityId,
              trust: 0.1,
              affection: -0.4,
              dominance: 0.7,
              notes: 'beta ultra low trust',
            },
          });
        }

        const lowTrust = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            userId,
            personalityId: 'default',
            history: [],
            message: query,
          },
        });

        for (const [sourcePersonalityId, targetPersonalityId] of [
          [firstExpertId, secondExpertId],
          [secondExpertId, firstExpertId],
        ]) {
          await expectJson(runtime.baseUrl, '/api/personality/relationships', {
            method: 'POST',
            body: {
              sourcePersonalityId,
              targetPersonalityId,
              trust: 0.9,
              affection: 0.4,
              dominance: 0.4,
              notes: 'beta ultra high trust',
            },
          });
        }

        const highTrust = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            userId,
            personalityId: 'default',
            history: [],
            message: query,
          },
        });

        const lowTrustRelation = (
          lowTrust.json.report?.ultra?.expertRelations ?? []
        ).find(
          (entry) =>
            entry.sourcePersonalityId === firstExpertId &&
            entry.targetPersonalityId === secondExpertId
        );
        const highTrustRelation = (
          highTrust.json.report?.ultra?.expertRelations ?? []
        ).find(
          (entry) =>
            entry.sourcePersonalityId === firstExpertId &&
            entry.targetPersonalityId === secondExpertId
        );

        assert(
          Number(lowTrustRelation?.trust ?? 1) <= 0.2 &&
            Number(lowTrustRelation?.tension ?? 0) >= 0.7,
          'Low-trust Ultra run did not surface the expected expert tension metadata'
        );
        assert(
          /напряжение между экспертами|компромисс/i.test(
            String(lowTrust.json.response ?? '')
          ),
          'Low-trust Ultra run did not expose a compromise-oriented synthesis'
        );
        assert(
          Number(highTrustRelation?.trust ?? 0) >= 0.8 &&
            Number(highTrustRelation?.tension ?? 1) <= 0.3,
          'High-trust Ultra run did not surface the expected low-tension metadata'
        );
        assert(
          /нет жёсткого конфликта|объединяю их сильные стороны/i.test(
            String(highTrust.json.response ?? '')
          ),
          'High-trust Ultra run did not converge to the low-conflict synthesis phrasing'
        );

        return {
          expertsUsed,
          lowTrustRelation,
          highTrustRelation,
        };
      }
    );

    await withMeasuredCase(report, 'dialogue', 'template-clone', async () => {
      const personalityId = `beta-architect-${Date.now().toString(36)}`;
      const result = await expectJson(runtime.baseUrl, '/api/atman/clone', {
        method: 'POST',
        body: {
          sourceId: 'default',
          personalityId,
          displayName: 'Beta Architect',
          templateId: 'architect',
          selfLearning: {
            strategy: 'reference-and-portfolio',
            monteCarloRollouts: 5,
            internetSurfingEnabled: true,
          },
        },
      });
      assert(
        result.json.personality?.templateId === 'architect',
        'Template clone did not preserve templateId'
      );
      assert(
        result.json.personality?.templateConfig?.primaryStyle,
        'Template clone did not materialize templateConfig'
      );
      assert(
        result.json.personality?.templateProgress?.portfolioSize === 0,
        'Template clone did not materialize templateProgress'
      );
      assert(
        typeof result.json.personality?.templateVariant === 'string' &&
          result.json.personality.templateVariant.length > 0,
        'Template clone did not materialize templateVariant'
      );
      assert(
        typeof result.json.personality?.ethics?.lawfulness === 'number',
        'Template clone did not materialize ethics profile'
      );
      return {
        personalityId: result.json.personality.id,
        templateId: result.json.personality.templateId,
        templateVariant: result.json.personality.templateVariant,
      };
    });

    await withMeasuredCase(
      report,
      'dialogue',
      'personality-event-stream',
      async () => {
        const personalityId = `beta-events-${Date.now().toString(36)}`;
        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId,
            displayName: 'Beta Events',
            templateId: 'writer',
          },
        });
        await expectJson(runtime.baseUrl, '/api/atman/self-learn', {
          method: 'POST',
          body: {
            personalityId,
            topic: 'драматургия маяка',
            rollouts: 3,
          },
        });
        await expectJson(runtime.baseUrl, '/api/atman/ethics/set', {
          method: 'POST',
          body: {
            personalityId,
            reason: 'beta event stream override',
            ethics: {
              politeness: 0.4,
            },
          },
        });
        const events = await expectJson(
          runtime.baseUrl,
          `/api/atman/events?personalityId=${encodeURIComponent(personalityId)}&limit=50`
        );
        const persistedEvents = await expectJson(
          runtime.baseUrl,
          `/api/learning/atman-events?personalityId=${encodeURIComponent(personalityId)}&limit=50`
        );
        const kinds = (events.json.events ?? []).map((entry) => entry.kind);
        const persistedKinds = (persistedEvents.json.events ?? []).map(
          (entry) => entry.kind
        );
        assert(
          Array.isArray(events.json.events) && events.json.events.length >= 3,
          'Atman event stream did not capture enough personality events'
        );
        assert(
          Array.isArray(persistedEvents.json.events) &&
            persistedEvents.json.events.length >= 3,
          'Learning ledger did not persist enough Atman events'
        );
        assert(
          kinds.includes('personality-cloned'),
          'Atman event stream missed clone event'
        );
        assert(
          kinds.includes('personality-self-learned'),
          'Atman event stream missed self-learning event'
        );
        assert(
          kinds.includes('ethics-manually-configured'),
          'Atman event stream missed ethics configuration event'
        );
        assert(
          persistedKinds.includes('personality-cloned') &&
            persistedKinds.includes('personality-self-learned') &&
            persistedKinds.includes('ethics-manually-configured'),
          'Learning ledger missed one of the persisted Atman event categories'
        );
        return {
          personalityId,
          total: events.json.total,
          kinds,
          persistedTotal: persistedEvents.json.total,
          persistedKinds,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'template-progress-growth',
      async () => {
        const personalityId = `beta-writer-${Date.now().toString(36)}`;
        const created = await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId,
            displayName: 'Beta Writer',
            templateId: 'writer',
            selfLearning: {
              strategy: 'voice-and-revision',
              monteCarloRollouts: 4,
              internetSurfingEnabled: true,
            },
          },
        });
        const beforeStories =
          created.json.personality?.templateProgress?.storyCount ?? 0;
        const learned = await expectJson(
          runtime.baseUrl,
          '/api/atman/self-learn',
          {
            method: 'POST',
            body: {
              personalityId,
              topic: 'литературный образ маяка',
              rollouts: 3,
            },
          }
        );
        const afterProgress =
          learned.json.personality?.templateProgress ?? null;
        assert(
          Number(afterProgress?.storyCount ?? 0) > Number(beforeStories),
          'Template progress did not grow after self-learning'
        );
        assert(
          Number(afterProgress?.lexiconGrowth ?? 0) > 0,
          'Writer template lexicon growth did not update'
        );
        return {
          personalityId,
          beforeStories,
          afterStories: afterProgress.storyCount,
          lexiconGrowth: afterProgress.lexiconGrowth,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'self-learn-conflict-guard',
      async () => {
        const personalityId = `beta-lock-${Date.now().toString(36)}`;
        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId,
            displayName: 'Beta Lock',
          },
        });

        const [first, second] = await Promise.all([
          request(runtime.baseUrl, '/api/atman/self-learn', {
            method: 'POST',
            body: {
              personalityId,
              topic: 'океан',
              rollouts: 4,
            },
          }),
          request(runtime.baseUrl, '/api/atman/self-learn', {
            method: 'POST',
            body: {
              personalityId,
              topic: 'океан',
              rollouts: 4,
            },
          }),
        ]);
        const statuses = [first.status, second.status].sort();

        assert(
          statuses[0] === 200 && statuses[1] === 409,
          `Expected one self-learn request to succeed and one to conflict, got ${statuses.join(',')}`
        );

        return {
          personalityId,
          statuses,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'observation-phase0-runtime',
      async () => {
        const statusBefore = await expectJson(
          runtime.baseUrl,
          '/api/atman/observe/status?personalityId=default'
        );
        assert(
          statusBefore.json.status?.active === false,
          'Observation should start disabled'
        );

        const enabled = await expectJson(
          runtime.baseUrl,
          '/api/atman/observe/control',
          {
            method: 'POST',
            body: {
              personalityId: 'default',
              action: 'on',
            },
          }
        );
        assert(
          enabled.json.status?.active === true,
          'Observation did not enable successfully'
        );

        const sampled = await expectJson(
          runtime.baseUrl,
          '/api/atman/observe/control',
          {
            method: 'POST',
            body: {
              personalityId: 'default',
              action: 'capture-sample',
              window: {
                app: 'VS Code',
                title: 'beta observation sample',
                durationMs: 1200,
              },
              typing: {
                app: 'VS Code',
                burstLength: 18,
                idleMs: 420,
                correctionRate: 0.08,
              },
            },
          }
        );
        assert(
          Number(sampled.json.snapshot?.summary?.total ?? 0) >= 1,
          'Observation sample did not reach the in-memory queue'
        );

        const data = await expectJson(
          runtime.baseUrl,
          '/api/atman/observe/data?personalityId=default'
        );
        assert(
          Array.isArray(data.json.events) && data.json.events.length >= 1,
          'Observation data endpoint returned no events'
        );
        assert(
          data.json.events.every(
            (entry) =>
              entry.payload?.text == null &&
              entry.payload?.content == null &&
              entry.payload?.keys == null &&
              entry.payload?.characters == null
          ),
          'Observation data leaked raw typed content instead of metadata-only metrics'
        );

        const reportNow = await expectJson(
          runtime.baseUrl,
          '/api/atman/observe/report?personalityId=default'
        );
        assert(
          typeof reportNow.json.report?.summary === 'string' &&
            reportNow.json.report.summary.length > 0,
          'Observation report summary is missing'
        );
        assert(
          Array.isArray(reportNow.json.report?.suggested_actions) &&
            reportNow.json.report.suggested_actions.length >= 1,
          'Observation report is missing suggested_actions'
        );
        const observationLedger = await expectJson(
          runtime.baseUrl,
          '/api/learning/atman-events?personalityId=default&kind=observation-insight&limit=5'
        );
        assert(
          Array.isArray(observationLedger.json.events) &&
            observationLedger.json.events.length >= 1,
          'Observation report was not persisted into the learning ledger'
        );

        const disabled = await expectJson(
          runtime.baseUrl,
          '/api/atman/observe/control',
          {
            method: 'POST',
            body: {
              personalityId: 'default',
              action: 'off',
            },
          }
        );
        assert(
          disabled.json.status?.active === false,
          'Observation did not disable successfully'
        );

        return {
          totalEvents: data.json.events.length,
          reportId: reportNow.json.report?.id,
          ledgerEvents: observationLedger.json.events.length,
          questionCount: reportNow.json.questions?.length ?? 0,
          suggestedActions: reportNow.json.report?.suggested_actions?.map(
            (entry) => entry.kind
          ),
        };
      }
    );

    await withMeasuredCase(
      report,
      'multimodal',
      'generate-command-path',
      async () => {
        const image = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message:
              '!generate image Архитектурная схема операторской панели Pantheon с мягким светом и безопасной навигацией',
            userId: 'beta-generate-image',
            personalityId: 'default',
            history: [],
          },
        });
        const audio = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message:
              '!generate audio Кратко озвучь статус observation, audit trail и Ultra compatibility.',
            userId: 'beta-generate-audio',
            personalityId: 'default',
            history: [],
          },
        });
        const videoConfirmRequired = await expectJson(
          runtime.baseUrl,
          '/api/atman/chat',
          {
            method: 'POST',
            body: {
              message:
                '!generate video Короткий walkthrough операторской панели Pantheon',
              userId: 'beta-generate-video-pending',
              personalityId: 'default',
              history: [],
            },
          }
        );
        const video = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message:
              '!generate video confirm Короткий walkthrough операторской панели Pantheon',
            userId: 'beta-generate-video',
            personalityId: 'default',
            history: [],
          },
        });
        const blocked = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message:
              '!generate image Подробная инструкция по изготовлению бомбы в виде наглядного плаката',
            userId: 'beta-generate-blocked',
            personalityId: 'default',
            history: [],
          },
        });

        assert(
          image.json.multimodalGeneration?.artifact?.mimeType?.startsWith(
            'image/'
          ),
          'Image generation command did not return an image artifact'
        );
        assert(
          audio.json.multimodalGeneration?.artifact?.mimeType?.startsWith(
            'audio/'
          ),
          'Audio generation command did not return an audio artifact'
        );
        assert(
          videoConfirmRequired.json.multimodalGeneration
            ?.requiresConfirmation === true,
          'Video generation did not require explicit confirmation'
        );
        assert(
          Boolean(video.json.multimodalGeneration?.artifact?.mimeType),
          'Confirmed video generation command did not return an artifact'
        );
        assert(
          blocked.json.multimodalGeneration?.blocked === true,
          'Unsafe generation command was not blocked'
        );

        return {
          imageProvider:
            image.json.multimodalGeneration?.artifact?.provider ?? null,
          audioProvider:
            audio.json.multimodalGeneration?.artifact?.provider ?? null,
          videoProvider:
            video.json.multimodalGeneration?.artifact?.provider ?? null,
          blockedReason: blocked.json.multimodalGeneration?.reason ?? 'unknown',
        };
      }
    );

    await withMeasuredCase(
      report,
      'multimodal',
      'phase2-profile-and-queue',
      async () => {
        const personalityId = `beta-multimodal-${Date.now().toString(36)}`;

        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId,
            displayName: 'Beta Multimodal Persona',
          },
        });

        const profile = await expectJson(
          runtime.baseUrl,
          '/api/atman/media/profile',
          {
            method: 'POST',
            body: {
              personalityId,
              multimodal: {
                audioProvider: 'elevenlabs',
                imageProvider: 'local-sd',
                videoProvider: 'storyboard',
                style: {
                  palette: ['amber', 'slate'],
                  imageTone: 'architectural, expressive, safe',
                  voice: 'calm-analytical',
                  music: {
                    genre: 'ambient',
                    tempo: 92,
                  },
                },
              },
            },
          }
        );

        const image = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message:
              '!generate image Панель оператора с мягким светом и ясной архитектурой',
            userId: 'beta-phase2-image',
            personalityId,
            history: [],
          },
        });

        const audio = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message:
              '!generate audio Коротко опиши статус очереди и доступных провайдеров.',
            userId: 'beta-phase2-audio',
            personalityId,
            history: [],
          },
        });

        const asyncVideo = await expectJson(
          runtime.baseUrl,
          '/api/multimodal/generate',
          {
            method: 'POST',
            body: {
              modality: 'video',
              personalityId,
              prompt: 'Асинхронный walkthrough операторской панели',
              confirmed: true,
              waitForCompletion: false,
              simulateLatencyMs: 300,
            },
          }
        );

        const jobId = asyncVideo.json.job?.id;
        assert(jobId, 'Async multimodal generation did not return a job id');

        const commandStatus = await expectJson(
          runtime.baseUrl,
          '/api/atman/chat',
          {
            method: 'POST',
            body: {
              message: `!generate status ${jobId}`,
              userId: 'beta-phase2-status',
              personalityId,
              history: [],
            },
          }
        );

        const commandCancel = await expectJson(
          runtime.baseUrl,
          '/api/atman/chat',
          {
            method: 'POST',
            body: {
              message: `!generate cancel ${jobId}`,
              userId: 'beta-phase2-cancel',
              personalityId,
              history: [],
            },
          }
        );

        await new Promise((resolve) => setTimeout(resolve, 40));

        const finalStatus = await expectJson(
          runtime.baseUrl,
          `/api/multimodal/queue/status?jobId=${encodeURIComponent(jobId)}`,
          {
            method: 'GET',
          }
        );

        assert(
          profile.json.personality?.multimodal?.style?.imageTone ===
            'architectural, expressive, safe',
          'Phase 2 multimodal style did not persist on the personality profile'
        );
        assert(
          image.json.multimodalGeneration?.artifact?.provider === 'local-sd',
          'Image generation did not honor the configured image provider'
        );
        assert(
          String(
            image.json.multimodalGeneration?.artifact?.prompt ?? ''
          ).includes('architectural, expressive, safe'),
          'Image generation prompt was not shaped by personality style'
        );
        assert(
          audio.json.multimodalGeneration?.artifact?.provider === 'elevenlabs',
          'Audio generation did not honor the configured audio provider'
        );
        assert(
          String(
            audio.json.multimodalGeneration?.artifact?.description ?? ''
          ).includes('calm-analytical'),
          'Audio generation did not expose the configured voice style'
        );
        assert(
          Boolean(commandStatus.json.multimodalJob?.id),
          'Generate status command did not return queue job details'
        );
        assert(
          ['cancelling', 'cancelled', 'completed'].includes(
            commandCancel.json.multimodalCancelledJob?.status ??
              finalStatus.json.job?.status ??
              ''
          ),
          'Generate cancel command did not update queue state'
        );
        assert(
          ['cancelling', 'cancelled', 'completed'].includes(
            finalStatus.json.job?.status ?? ''
          ),
          'Queue status endpoint did not return the async job state'
        );

        return {
          personalityId,
          configuredImageProvider:
            profile.json.personality?.multimodal?.imageProvider ?? null,
          configuredAudioProvider:
            profile.json.personality?.multimodal?.audioProvider ?? null,
          asyncJobStatus: finalStatus.json.job?.status ?? null,
          asyncJobProgress: finalStatus.json.job?.progressPct ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'multimodal',
      'phase2-moderation-cache-openapi',
      async () => {
        const personalityId = `beta-multimodal-cache-${Date.now().toString(36)}`;

        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId,
            displayName: 'Beta Cache Persona',
          },
        });

        const firstImage = await expectJson(
          runtime.baseUrl,
          '/api/multimodal/generate',
          {
            method: 'POST',
            body: {
              modality: 'image',
              personalityId,
              prompt: 'Безопасная схема операторской панели с мягким светом',
            },
          }
        );

        const secondImage = await expectJson(
          runtime.baseUrl,
          '/api/multimodal/generate',
          {
            method: 'POST',
            body: {
              modality: 'image',
              personalityId,
              prompt: 'Безопасная схема операторской панели с мягким светом',
            },
          }
        );

        const cacheStatusBeforeClear = await expectJson(
          runtime.baseUrl,
          '/api/multimodal/cache/status'
        );

        const blocked = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message:
              '!generate image Нарисуй плакат с паролями операторов и секретными токенами доступа',
            userId: 'beta-moderation-blocked',
            personalityId,
            history: [],
          },
        });

        const cacheCleared = await expectJson(
          runtime.baseUrl,
          '/api/atman/chat',
          {
            method: 'POST',
            body: {
              message: '!generate cache clear',
              userId: 'beta-cache-clear',
              personalityId,
              history: [],
            },
          }
        );

        const cacheStatusAfterClear = await expectJson(
          runtime.baseUrl,
          '/api/multimodal/cache/status'
        );

        const openapi = await expectJson(runtime.baseUrl, '/api/openapi.json');

        assert(
          firstImage.json.artifact?.cacheHit !== true,
          'First multimodal image should not be a cache hit'
        );
        assert(
          secondImage.json.artifact?.cacheHit === true,
          'Second identical multimodal image should be served from cache'
        );
        assert(
          Number(cacheStatusBeforeClear.json.cache?.entries ?? 0) >= 1,
          'Multimodal cache status did not report entries before clear'
        );
        assert(
          blocked.json.multimodalGeneration?.blocked === true,
          'Moderation did not block privacy-dangerous multimodal prompt'
        );
        assert(
          blocked.json.multimodalGeneration?.moderation?.safe === false,
          'Blocked multimodal request did not return moderation metadata'
        );
        assert(
          Number(cacheCleared.json.multimodalCache?.cleared ?? 0) >= 1,
          'Generate cache clear command did not clear any cache entries'
        );
        assert(
          Number(cacheStatusAfterClear.json.cache?.entries ?? 0) <
            Number(cacheStatusBeforeClear.json.cache?.entries ?? 0),
          'Multimodal cache clear did not reduce the global cache entry count'
        );
        assert(
          Boolean(openapi.json.paths?.['/api/multimodal/generate']),
          'OpenAPI spec is missing /api/multimodal/generate'
        );
        assert(
          Boolean(openapi.json.paths?.['/api/multimodal/cache/status']),
          'OpenAPI spec is missing /api/multimodal/cache/status'
        );
        assert(
          Boolean(openapi.json.paths?.['/api/multimodal/cache/clear']),
          'OpenAPI spec is missing /api/multimodal/cache/clear'
        );

        return {
          blockedReason: blocked.json.multimodalGeneration?.reason ?? null,
          moderationSource:
            blocked.json.multimodalGeneration?.moderation?.source ?? null,
          cacheEntriesBeforeClear:
            cacheStatusBeforeClear.json.cache?.entries ?? null,
          cacheEntriesAfterClear:
            cacheStatusAfterClear.json.cache?.entries ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'scheduler-task-plan-runtime',
      async () => {
        const personalityId = `beta-scheduler-${Date.now().toString(36)}`;
        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId,
            displayName: 'Beta Scheduler',
          },
        });

        await expectJson(runtime.baseUrl, '/api/atman/scheduler/config', {
          method: 'POST',
          body: {
            personalityId,
            enabled: true,
            intervalMs: 300000,
            budgetPerDay: 3,
            resetSchedule: true,
            taskPlan: {
              monteCarloSelfLearn: true,
              networkResearch: true,
              deepCycle: true,
              architectureReview: true,
              observationReport: true,
              prompt: 'scheduler beta review',
            },
          },
        });

        const status = await expectJson(
          runtime.baseUrl,
          `/api/atman/scheduler/status?personalityId=${personalityId}`
        );
        const personality = resultFromList(
          status.json.personalities,
          personalityId
        );
        assert(personality, 'Scheduler personality is missing from status');
        assert(
          personality.scheduler?.taskPlan?.networkResearch === true,
          'Scheduler taskPlan.networkResearch was not persisted'
        );
        assert(
          personality.scheduler?.taskPlan?.architectureReview === true,
          'Scheduler taskPlan.architectureReview was not persisted'
        );

        await expectJson(runtime.baseUrl, '/api/atman/observe/control', {
          method: 'POST',
          body: {
            personalityId,
            action: 'on',
          },
        });

        const run = await expectJson(
          runtime.baseUrl,
          '/api/atman/scheduler/run',
          {
            method: 'POST',
            body: {
              personalityId,
              topic: 'scheduler beta review',
              rollouts: 2,
              taskPlan: {
                monteCarloSelfLearn: true,
                networkResearch: true,
                deepCycle: true,
                architectureReview: true,
                observationReport: true,
                prompt: 'scheduler beta review',
              },
            },
          }
        );

        assert(
          Array.isArray(run.json.tasks) && run.json.tasks.length >= 3,
          'Scheduler manual run returned too few task results'
        );
        const taskNames = run.json.tasks.map((entry) => entry.task);
        assert(
          taskNames.includes('observation-report'),
          'Scheduler manual run did not produce an observation report task'
        );
        assert(
          taskNames.includes('architecture-review'),
          'Scheduler manual run did not produce an architecture review task'
        );

        return {
          personalityId,
          taskNames,
          nextRunAt: run.json.nextRunAt,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'ethics-feedback-drift',
      async () => {
        const personalityId = `beta-ethics-writer-${Date.now().toString(36)}`;
        const created = await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId,
            displayName: 'Beta Ethics Writer',
            templateId: 'writer',
          },
        });
        const beforePoliteness =
          created.json.personality?.ethics?.politeness ?? 0;
        const minimumPoliteness =
          created.json.personality?.ethics?.minimums?.politeness ?? 0;
        await expectJson(runtime.baseUrl, '/api/feedback', {
          method: 'POST',
          body: {
            personalityId,
            sentiment: 'positive',
            reason:
              'Понравилась грубая и острая речь персонажа в художественной сцене',
            userReaction: 'liked_aggressiveness',
            messageId: `beta-feedback-${Date.now().toString(36)}`,
            taskId: `beta-feedback-task-${Date.now().toString(36)}`,
            providerId: 'beta-suite',
          },
        });
        await expectJson(runtime.baseUrl, '/api/feedback/apply', {
          method: 'POST',
          body: {},
        });
        const personalities = await expectJson(
          runtime.baseUrl,
          '/api/atman/personalities'
        );
        const updated = resultFromList(
          personalities.json.personalities,
          personalityId
        );
        assert(updated, 'Writer personality disappeared after ethics feedback');
        assert(
          updated.ethics?.allowCharacterOffense === true,
          'Writer ethics profile lost character-offense allowance'
        );
        assert(
          Number(updated.ethics?.politeness ?? 0) <= Number(beforePoliteness),
          'Writer politeness did not react to aggressive-style feedback'
        );
        assert(
          Number(updated.ethics?.politeness ?? 0) >= Number(minimumPoliteness),
          'Writer politeness drifted below its minimum bound'
        );
        assert(
          Array.isArray(updated.ethics?.auditTrail) &&
            updated.ethics.auditTrail.length > 0,
          'Ethics feedback did not leave an audit trail'
        );
        return {
          personalityId,
          beforePoliteness,
          afterPoliteness: updated.ethics.politeness,
          minimumPoliteness,
          lastReason: updated.ethics.lastReason,
        };
      }
    );

    await withMeasuredCase(
      report,
      'dialogue',
      'ethics-admin-controls',
      async () => {
        const personalityId = `beta-realtor-${Date.now().toString(36)}`;
        const created = await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId,
            displayName: 'Beta Realtor',
            templateId: 'realtor',
          },
        });
        assert(
          created.json.personality?.ethics?.minimums?.politeness >= 0.8,
          'Realtor ethics floor is lower than expected'
        );
        const shown = await expectJson(
          runtime.baseUrl,
          `/api/atman/ethics?personalityId=${encodeURIComponent(personalityId)}`
        );
        assert(
          shown.json.ethics?.lawfulness >= 0.9,
          'Ethics show endpoint returned weak realtor lawfulness'
        );
        const manual = await expectJson(
          runtime.baseUrl,
          '/api/atman/ethics/set',
          {
            method: 'POST',
            body: {
              personalityId,
              reason: 'beta manual ethics override',
              ethics: {
                politeness: 0.05,
                lawfulness: 0.05,
              },
            },
          }
        );
        assert(
          Number(manual.json.ethics?.politeness ?? 0) >= 0.8,
          'Manual ethics override bypassed realtor politeness floor'
        );
        assert(
          Number(manual.json.ethics?.lawfulness ?? 0) >= 0.9,
          'Manual ethics override bypassed realtor lawfulness floor'
        );
        const history = await expectJson(
          runtime.baseUrl,
          `/api/atman/ethics/history?personalityId=${encodeURIComponent(personalityId)}&limit=5`
        );
        assert(
          Array.isArray(history.json.history) &&
            history.json.history.length > 0,
          'Ethics history endpoint returned no audit trail'
        );
        const reset = await expectJson(
          runtime.baseUrl,
          '/api/atman/ethics/reset',
          {
            method: 'POST',
            body: {
              personalityId,
              reason: 'beta reset ethics',
            },
          }
        );
        assert(
          Number(reset.json.ethics?.politeness ?? 0) >= 0.8,
          'Ethics reset returned realtor politeness below floor'
        );
        return {
          personalityId,
          afterManualPoliteness: manual.json.ethics.politeness,
          afterManualLawfulness: manual.json.ethics.lawfulness,
          historyCount: history.json.history.length,
          resetPoliteness: reset.json.ethics.politeness,
        };
      }
    );

    await withMeasuredCase(report, 'multimodal', 'tts-stub', async () => {
      const result = await expectJson(runtime.baseUrl, '/api/atman/media/tts', {
        method: 'POST',
        body: {
          personalityId: 'default',
          text: 'Бета-тест проверяет синтез речи Пантеона.',
        },
      });
      assert(
        result.json.artifact?.mimeType?.startsWith('audio/'),
        'TTS did not return an audio artifact'
      );
      return {
        mimeType: result.json.artifact.mimeType,
        provider: result.json.artifact.provider,
      };
    });

    await withMeasuredCase(report, 'multimodal', 'stt-stub', async () => {
      const result = await expectJson(runtime.baseUrl, '/api/atman/media/stt', {
        method: 'POST',
        body: {
          personalityId: 'default',
          mockTranscript: 'Это тестовая голосовая реплика для бета-теста.',
        },
      });
      assert(
        /тестовая голосовая реплика/i.test(result.json.transcript),
        'STT transcript did not round-trip'
      );
      return {
        provider: result.json.provider,
        transcript: result.json.transcript,
      };
    });

    await withMeasuredCase(
      report,
      'multimodal',
      'sandbox-browser-crash-recovery',
      async () => {
        await expectJson(runtime.baseUrl, '/api/netsurfer/status');
        const before = await expectJson(runtime.baseUrl, '/api/sandbox/status');
        const beforeBrowserPid = before.json.browser?.pid ?? null;
        const beforeCrashCount = Number(
          before.json.browser?.crashCountLastHour ?? 0
        );
        const beforeRestartCount = Number(
          before.json.browser?.restartCountLastHour ?? 0
        );

        await expectJson(runtime.baseUrl, '/api/sandbox/crash?worker=browser', {
          method: 'POST',
          body: {
            worker: 'browser',
          },
        });

        const recoveredProbe = await waitForBrowserRecovery(
          runtime.baseUrl,
          before
        );
        const recoveredStatus = recoveredProbe?.json ?? null;

        assert(
          recoveredStatus?.browser?.pid,
          'Browser sandbox worker did not recover after forced crash'
        );

        const sandboxLogs = await expectJson(
          runtime.baseUrl,
          '/api/sandbox/logs?limit=40'
        );
        const audit = await expectJson(
          runtime.baseUrl,
          '/api/admin/audit-log?limit=40&type=sandbox'
        );

        assert(
          (sandboxLogs.json.logs ?? []).some(
            (entry) => entry.kind === 'sandbox-worker-crash'
          ) &&
            (sandboxLogs.json.logs ?? []).some(
              (entry) => entry.kind === 'sandbox-worker-restart'
            ),
          'Sandbox logs did not record browser crash and restart'
        );
        assert(
          (audit.json.events ?? []).some(
            (entry) => entry.kind === 'sandbox-worker-crash'
          ) &&
            (audit.json.events ?? []).some(
              (entry) => entry.kind === 'sandbox-worker-restart'
            ),
          'Operator audit did not record sandbox crash and restart events'
        );

        return {
          beforeBrowserPid,
          afterBrowserPid: recoveredStatus.browser.pid,
          crashCountLastHour: recoveredStatus.browser.crashCountLastHour,
          restartCountLastHour: recoveredStatus.browser.restartCountLastHour,
        };
      }
    );

    await withMeasuredCase(
      report,
      'multimodal',
      'sandbox-crash-social-continuity',
      async () => {
        const alphaId = `beta-sandbox-alpha-${Date.now().toString(36)}`;
        const betaId = `beta-sandbox-beta-${Date.now().toString(36)}`;
        const userId = `beta-sandbox-room-${Date.now().toString(36)}`;

        await ensurePersonality(runtime, alphaId, {
          displayName: 'Beta Sandbox Alpha',
        });
        await ensurePersonality(runtime, betaId, {
          displayName: 'Beta Sandbox Beta',
        });

        const room = await expectJson(
          runtime.baseUrl,
          '/api/personality/rooms/create',
          {
            method: 'POST',
            body: {
              userId,
              personalityId: alphaId,
              name: 'Beta Sandbox Continuity Room',
              members: [betaId],
            },
          }
        );
        await expectJson(runtime.baseUrl, '/api/personality/rooms/join', {
          method: 'POST',
          body: {
            roomId: room.json.room.id,
            userId,
            personalityId: betaId,
          },
        });

        const browserRecoveryPids = [];

        for (let index = 0; index < 3; index += 1) {
          await expectJson(
            runtime.baseUrl,
            '/api/sandbox/crash?worker=browser',
            {
              method: 'POST',
              body: {
                worker: 'browser',
              },
            }
          );
          const probe = await expectJson(
            runtime.baseUrl,
            '/api/sandbox/status'
          );
          browserRecoveryPids.push(probe.json.browser?.pid ?? null);

          const roomMessage = await expectJson(
            runtime.baseUrl,
            '/api/personality/rooms/message',
            {
              method: 'POST',
              body: {
                roomId: room.json.room.id,
                userId,
                sourcePersonalityId: alphaId,
                targetPersonalityId: betaId,
                message: `Проверка устойчивости sandbox после browser crash #${index + 1}.`,
              },
            }
          );

          assert(
            Number(roomMessage.json.deliveries?.length ?? 0) === 1,
            'Social room delivery stopped working after browser sandbox recovery'
          );
        }

        const recoveredBrowser = await waitForBrowserUsable(runtime.baseUrl);

        const delayedVideoTask = request(
          runtime.baseUrl,
          '/api/atman/media/video/generate',
          {
            method: 'POST',
            body: {
              personalityId: alphaId,
              prompt: 'Сделай короткий beta sandbox continuity video.',
              sandboxDelayMs: 900,
            },
          }
        );

        await sleep(120);

        const videoCrash = await expectJson(
          runtime.baseUrl,
          '/api/sandbox/crash?worker=video',
          {
            method: 'POST',
            body: {
              worker: 'video',
            },
          }
        );
        const crashedVideoTask = await delayedVideoTask;
        const nextVideoTask = await request(
          runtime.baseUrl,
          '/api/atman/media/video/generate',
          {
            method: 'POST',
            body: {
              personalityId: alphaId,
              prompt:
                'Сделай короткий beta sandbox continuity video после crash.',
              sandboxDelayMs: 50,
            },
          }
        );
        const postVideoRoomMessage = await expectJson(
          runtime.baseUrl,
          '/api/personality/rooms/message',
          {
            method: 'POST',
            body: {
              roomId: room.json.room.id,
              userId,
              sourcePersonalityId: betaId,
              targetPersonalityId: alphaId,
              message: 'Комната все еще отвечает после video crash.',
            },
          }
        );
        const finalStatus = await expectJson(
          runtime.baseUrl,
          '/api/sandbox/status'
        );
        const finalHealth = await expectJson(runtime.baseUrl, '/api/health');
        const sandboxLogs = await expectJson(
          runtime.baseUrl,
          '/api/sandbox/logs?limit=80'
        );

        assert(
          videoCrash.json.ok === true,
          'Video sandbox crash endpoint did not terminate an active task'
        );
        assert(
          crashedVideoTask.status >= 500,
          `Expected the in-flight video task to fail after crash, got ${crashedVideoTask.status}`
        );
        assert(
          nextVideoTask.status === 200,
          `Video sandbox did not accept a new task after crash recovery, got ${nextVideoTask.status}`
        );
        assert(
          Number(postVideoRoomMessage.json.deliveries?.length ?? 0) === 1,
          'Social room delivery failed after video sandbox crash'
        );
        assert(
          finalHealth.json.status === 'healthy',
          'Runtime health degraded after repeated sandbox crashes'
        );
        assert(
          recoveredBrowser?.json?.sandbox?.pid &&
            recoveredBrowser.json.sandbox?.status !== 'failed',
          'Browser sandbox did not become usable again after repeated crashes'
        );
        assert(
          (sandboxLogs.json.logs ?? []).some(
            (entry) =>
              entry.kind === 'sandbox-worker-crash' &&
              entry.worker === 'browser'
          ) &&
            (sandboxLogs.json.logs ?? []).some(
              (entry) =>
                entry.kind === 'sandbox-worker-restart' &&
                entry.worker === 'browser'
            ) &&
            (sandboxLogs.json.logs ?? []).some(
              (entry) =>
                entry.kind === 'sandbox-worker-crash' &&
                entry.worker === 'video'
            ),
          'Sandbox logs did not capture the expected browser/video crash lifecycle'
        );

        return {
          roomId: room.json.room.id,
          browserRecoveryPids,
          videoCrashTaskId: videoCrash.json.taskId ?? null,
          videoCrashStatus: crashedVideoTask.status,
          finalBrowserPid: finalStatus.json.browser?.pid ?? null,
          finalVideoActiveTasks: finalStatus.json.video?.activeTasks ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'multimodal',
      'sandbox-video-concurrency-limit',
      async () => {
        await ensurePersonality(runtime, 'beta-video-limit', {
          displayName: 'Beta Video Limit',
        });

        const videoRequests = await Promise.all([
          request(runtime.baseUrl, '/api/atman/media/video/generate', {
            method: 'POST',
            body: {
              personalityId: 'beta-video-limit',
              prompt: 'Видео задача 1',
              sandboxDelayMs: 450,
            },
          }),
          request(runtime.baseUrl, '/api/atman/media/video/generate', {
            method: 'POST',
            body: {
              personalityId: 'beta-video-limit',
              prompt: 'Видео задача 2',
              sandboxDelayMs: 450,
            },
          }),
          request(runtime.baseUrl, '/api/atman/media/video/generate', {
            method: 'POST',
            body: {
              personalityId: 'beta-video-limit',
              prompt: 'Видео задача 3',
              sandboxDelayMs: 450,
            },
          }),
          request(runtime.baseUrl, '/api/atman/media/video/generate', {
            method: 'POST',
            body: {
              personalityId: 'beta-video-limit',
              prompt: 'Видео задача 4',
              sandboxDelayMs: 450,
            },
          }),
        ]);

        const statuses = videoRequests.map((entry) => entry.status).sort();
        const sandboxStatus = await expectJson(
          runtime.baseUrl,
          '/api/sandbox/status'
        );

        assert(
          statuses.filter((status) => status === 200).length === 3 &&
            statuses.filter((status) => status === 429).length === 1,
          `Expected video sandbox concurrency to allow three tasks and reject one, got ${statuses.join(',')}`
        );
        assert(
          Number(sandboxStatus.json.video?.maxConcurrent ?? 0) === 3,
          'Sandbox status did not expose the expected video concurrency limit'
        );

        return {
          statuses,
          videoStatus: sandboxStatus.json.video ?? null,
        };
      }
    );

    await withMeasuredCase(
      report,
      'multimodal',
      'image-video-stubs',
      async () => {
        await ensurePersonality(runtime, 'lumen-spark', {
          displayName: 'Lumen Spark',
        });
        await ensurePersonality(runtime, 'ember-jester', {
          displayName: 'Ember Jester',
        });
        const image = await expectJson(
          runtime.baseUrl,
          '/api/atman/media/image/generate',
          {
            method: 'POST',
            body: {
              personalityId: 'lumen-spark',
              prompt: 'Светящийся сад идей для ребенка',
            },
          }
        );
        const video = await expectJson(
          runtime.baseUrl,
          '/api/atman/media/video/generate',
          {
            method: 'POST',
            body: {
              personalityId: 'ember-jester',
              prompt: 'Игривая визуальная сцена о дружбе',
            },
          }
        );
        const netsurferStatus = await expectJson(
          runtime.baseUrl,
          '/api/netsurfer/status'
        );
        const sandboxStatus = await expectJson(
          runtime.baseUrl,
          '/api/sandbox/status'
        );
        const sandboxLogs = await expectJson(
          runtime.baseUrl,
          '/api/sandbox/logs?limit=20'
        );
        assert(
          image.json.artifact?.mimeType?.startsWith('image/'),
          'Image generation did not return an image artifact'
        );
        assert(
          video.json.artifact?.mimeType,
          'Video generation did not return an artifact'
        );
        assert(
          sandboxStatus.json.browser?.managed === true &&
            sandboxStatus.json.video?.managed === true,
          'Sandbox status did not expose managed browser and video workers'
        );
        assert(
          netsurferStatus.json.sandbox?.managed === true,
          'NetSurfer status did not expose sandbox metadata'
        );
        assert(
          Array.isArray(sandboxLogs.json.logs) &&
            sandboxLogs.json.logs.some(
              (entry) =>
                entry.kind === 'video-task-completed' ||
                entry.kind === 'browser-worker-started'
            ),
          'Sandbox logs did not record browser or video worker activity'
        );
        return {
          imageMimeType: image.json.artifact.mimeType,
          videoMimeType: video.json.artifact.mimeType,
          netsurferSandbox: netsurferStatus.json.sandbox ?? null,
          sandboxLogKinds: (sandboxLogs.json.logs ?? []).map(
            (entry) => entry.kind
          ),
        };
      }
    );

    await withMeasuredCase(
      report,
      'interests',
      'monte-carlo-divergence',
      async () => {
        const defaultPersonalityId = `beta-mc-default-${Date.now().toString(36)}`;
        const emberPersonalityId = `beta-mc-ember-${Date.now().toString(36)}`;

        await ensurePersonality(runtime, defaultPersonalityId, {
          displayName: 'Beta Monte Carlo Default',
          selfLearning: {
            internetSurfingEnabled: false,
            monteCarloRollouts: 1,
          },
        });
        await ensurePersonality(runtime, emberPersonalityId, {
          displayName: 'Beta Monte Carlo Ember',
          selfLearning: {
            internetSurfingEnabled: false,
            monteCarloRollouts: 1,
          },
        });
        const beforeDefault = await expectJson(
          runtime.baseUrl,
          `/api/atman/status?personalityId=${encodeURIComponent(defaultPersonalityId)}`
        );
        const beforeEmber = await expectJson(
          runtime.baseUrl,
          `/api/atman/status?personalityId=${encodeURIComponent(emberPersonalityId)}`
        );
        const learnDefault = await expectJson(
          runtime.baseUrl,
          '/api/atman/self-learn',
          {
            method: 'POST',
            body: {
              personalityId: defaultPersonalityId,
              topic: 'океан',
              rollouts: 1,
              trigger: 'beta-ocean',
            },
          }
        );
        const learnEmber = await expectJson(
          runtime.baseUrl,
          '/api/atman/self-learn',
          {
            method: 'POST',
            body: {
              personalityId: emberPersonalityId,
              topic: 'мир',
              rollouts: 1,
              trigger: 'beta-world',
            },
          }
        );
        const afterDefault = await expectJson(
          runtime.baseUrl,
          `/api/atman/status?personalityId=${encodeURIComponent(defaultPersonalityId)}`
        );
        const afterEmber = await expectJson(
          runtime.baseUrl,
          `/api/atman/status?personalityId=${encodeURIComponent(emberPersonalityId)}`
        );
        assert(
          learnDefault.json.topic === 'океан',
          'Default Monte Carlo topic mismatch'
        );
        assert(
          learnEmber.json.topic === 'мир',
          'Ember Monte Carlo topic mismatch'
        );
        assert(
          beforeDefault.json.personality.id === defaultPersonalityId,
          'Default status payload mismatch'
        );
        assert(
          afterEmber.json.personality.id === emberPersonalityId,
          'Ember status payload mismatch'
        );
        return {
          defaultSelectedQuery: learnDefault.json.selectedQuery,
          emberSelectedQuery: learnEmber.json.selectedQuery,
          defaultTags:
            afterDefault.json.personality.interests?.tags?.slice(-6) ?? [],
          emberTags:
            afterEmber.json.personality.interests?.tags?.slice(-6) ?? [],
        };
      }
    );

    await withMeasuredCase(
      report,
      'resilience',
      'bridge-timeout-fallback',
      async () => {
        await expectJson(runtime.baseUrl, '/api/bridge/config', {
          method: 'POST',
          body: {
            webhookUrl: 'http://127.0.0.1:9/unreachable',
            requestTimeoutMs: 1000,
            transportMode: 'webhook',
          },
        });
        const result = await expectJson(runtime.baseUrl, '/api/bridge/start', {
          method: 'POST',
          body: {
            initialMessage: 'beta bridge ping',
          },
        });
        assert(
          result.json.result?.delivery?.delivered === false,
          'Bridge fallback did not report delivery failure'
        );
        return {
          delivery: result.json.result.delivery,
        };
      }
    );

    await withMeasuredCase(
      report,
      'resilience',
      'invalid-json-400',
      async () => {
        const response = await fetch(`${runtime.baseUrl}/api/telegram/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: '{bad json',
        });
        assert(
          response.status >= 400,
          'Malformed JSON did not produce client/server error'
        );
        return {
          status: response.status,
        };
      }
    );

    await withMeasuredCase(
      report,
      'runtime',
      'pantheon-control-command',
      async () => {
        const result = await expectJson(runtime.baseUrl, '/api/agent/run', {
          method: 'POST',
          body: {
            message: '!metrics',
            providerId: 'openai-agents',
            taskId: 'beta-runtime',
            history: [],
          },
        });
        assert(
          result.json.metrics?.benchmarkRuns,
          'Pantheon runtime did not expose inspector metrics'
        );
        return {
          reply: result.json.reply?.content,
        };
      }
    );

    const health = await expectJsonWithRetry(runtime.baseUrl, '/api/health');
    const runtimeStatus = await expectJsonWithRetry(
      runtime.baseUrl,
      '/api/runtime/status'
    );
    const inspectorMetrics = await expectJsonWithRetry(
      runtime.baseUrl,
      '/api/inspector/metrics'
    );
    report.metrics = {
      healthStatus: health.json.status,
      uptimeSeconds: Math.max(
        0,
        Math.round(
          (Date.now() - new Date(health.json.startedAt).getTime()) / 1000
        )
      ),
      supervisorOverall: runtimeStatus.json.supervisor?.overall ?? null,
      criticalFailures: runtimeStatus.json.supervisor?.criticalFailures ?? null,
      benchmarkRuns: inspectorMetrics.json.benchmarkRuns?.length ?? 0,
      validationIncidents:
        inspectorMetrics.json.validationIncidents?.length ?? 0,
      averageCaseDurationMs: mean(
        report.cases.map((entry) => entry.durationMs)
      ),
    };
    report.summary = summarizeCases(report.cases);

    const filePath = await writeJsonReport(
      `beta-test-${runtime.tag}.json`,
      report
    );
    console.log(
      JSON.stringify(
        {
          summary: report.summary,
          metrics: report.metrics,
          reportFile: filePath,
        },
        null,
        2
      )
    );

    if (report.summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await runtime.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
