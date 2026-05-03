import {
  expectJson,
  mean,
  openWebSocket,
  request,
  startManagedRuntime,
  writeJsonReport,
} from './beta-utils.mjs';

const concurrency = Math.max(
  1,
  Number(process.env.BETA_LOAD_CONCURRENCY ?? 20)
);
const rounds = Math.max(1, Number(process.env.BETA_LOAD_ROUNDS ?? 2));
const loadMode = process.env.BETA_LOAD_MODE ?? 'ultra';
const ultraMode = loadMode === 'ultra';
const socialRoomsMode = loadMode === 'social-rooms';
const socialGovernanceMode = loadMode === 'social-governance';
const withObservation = process.env.BETA_LOAD_WITH_OBSERVATION === 'true';
const socialRoomCount = Math.max(
  1,
  Number(process.env.BETA_LOAD_SOCIAL_ROOM_COUNT ?? 3)
);
const socialPersonalityCount = Math.max(
  socialRoomCount,
  Number(process.env.BETA_LOAD_SOCIAL_PERSONALITY_COUNT ?? 10)
);
const personalities = [
  'default',
  'ember-jester',
  'lumen-spark',
  'stoic-sentinel',
  'tide-dreamer',
];

function percentile(values, ratio) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  );
  return Number(sorted[index].toFixed(2));
}

async function enableObservation(baseUrl) {
  await expectJson(baseUrl, '/api/atman/observe/control', {
    method: 'POST',
    body: {
      personalityId: 'default',
      action: 'on',
    },
  });
}

async function captureObservationSample(baseUrl, title) {
  await expectJson(baseUrl, '/api/atman/observe/control', {
    method: 'POST',
    body: {
      personalityId: 'default',
      action: 'capture-sample',
      window: {
        app: 'Beta Load',
        title,
        durationMs: 900,
      },
      typing: {
        app: 'Beta Load',
        burstLength: 12,
        idleMs: 200,
        correctionRate: 0.05,
      },
    },
  });
}

async function finishObservation(baseUrl) {
  const observationReport = await expectJson(
    baseUrl,
    '/api/atman/observe/report?personalityId=default'
  );
  await expectJson(baseUrl, '/api/atman/observe/control', {
    method: 'POST',
    body: {
      personalityId: 'default',
      action: 'off',
    },
  });

  return observationReport.json.report?.id ?? null;
}

async function setupSocialRooms(runtime, socialSockets, socialRoomEventCounts) {
  const socialPersonalities = [];

  for (let index = 0; index < socialPersonalityCount; index += 1) {
    const personalityId = `beta-load-social-${index}`;
    socialPersonalities.push(personalityId);
    await expectJson(runtime.baseUrl, '/api/atman/clone', {
      method: 'POST',
      body: {
        sourceId: 'default',
        personalityId,
        displayName: `Beta Load Social ${index}`,
      },
    });
  }

  return Promise.all(
    Array.from({ length: socialRoomCount }, async (_, roomIndex) => {
      const members = socialPersonalities.filter(
        (_, personalityIndex) =>
          personalityIndex % socialRoomCount === roomIndex
      );
      const room = await expectJson(
        runtime.baseUrl,
        '/api/personality/rooms/create',
        {
          method: 'POST',
          body: {
            userId: `beta-load-room-${roomIndex}`,
            personalityId: members[0],
            name: `Beta Load Room ${roomIndex}`,
            members: members.slice(1),
          },
        }
      );
      const roomId = room.json.room.id;
      socialRoomEventCounts.set(roomId, 0);
      const socket = await openWebSocket(
        runtime.baseUrl,
        `/ws/social/room/${encodeURIComponent(roomId)}`
      );
      socket.addEventListener('message', () => {
        socialRoomEventCounts.set(
          roomId,
          Number(socialRoomEventCounts.get(roomId) ?? 0) + 1
        );
      });
      socialSockets.push(socket);
      return room.json.room;
    })
  );
}

async function setupGovernanceRoom(
  runtime,
  socialSockets,
  socialRoomEventCounts
) {
  const members = [];

  for (let index = 0; index < 5; index += 1) {
    const personalityId = `beta-governance-social-${index}`;
    members.push(personalityId);
    await expectJson(runtime.baseUrl, '/api/atman/clone', {
      method: 'POST',
      body: {
        sourceId: 'default',
        personalityId,
        displayName: `Beta Governance ${index}`,
      },
    });
  }

  const room = await expectJson(
    runtime.baseUrl,
    '/api/personality/rooms/create',
    {
      method: 'POST',
      body: {
        userId: 'beta-load-governance',
        personalityId: members[0],
        name: 'Beta Governance Load Room',
        members: members.slice(1),
      },
    }
  );
  const roomId = room.json.room.id;
  socialRoomEventCounts.set(roomId, 0);
  for (const personalityId of members.slice(1)) {
    await expectJson(runtime.baseUrl, '/api/personality/rooms/join', {
      method: 'POST',
      body: {
        roomId,
        userId: 'beta-load-governance',
        personalityId,
      },
    });
  }
  const socket = await openWebSocket(
    runtime.baseUrl,
    `/ws/social/room/${encodeURIComponent(roomId)}`
  );
  socket.addEventListener('message', () => {
    socialRoomEventCounts.set(
      roomId,
      Number(socialRoomEventCounts.get(roomId) ?? 0) + 1
    );
  });
  socialSockets.push(socket);

  await expectJson(runtime.baseUrl, '/api/personality/rooms/coalition/create', {
    method: 'POST',
    body: {
      roomId,
      coalitionId: 'red-team',
      name: 'Red Team',
      personalityId: members[0],
    },
  });
  await expectJson(runtime.baseUrl, '/api/personality/rooms/coalition/join', {
    method: 'POST',
    body: {
      roomId,
      coalitionId: 'red-team',
      personalityId: members[1],
    },
  });
  await expectJson(runtime.baseUrl, '/api/personality/rooms/coalition/create', {
    method: 'POST',
    body: {
      roomId,
      coalitionId: 'blue-team',
      name: 'Blue Team',
      personalityId: members[2],
    },
  });
  await expectJson(runtime.baseUrl, '/api/personality/rooms/coalition/join', {
    method: 'POST',
    body: {
      roomId,
      coalitionId: 'blue-team',
      personalityId: members[3],
    },
  });
  await expectJson(runtime.baseUrl, '/api/personality/rooms/conflict/declare', {
    method: 'POST',
    body: {
      roomId,
      personalityId: members[0],
      targetPersonalityId: members[2],
      reason: 'beta governance load conflict',
    },
  });

  return {
    room: room.json.room,
    senders: members.slice(0, 4),
    expectedTargets: new Map([
      [members[0], members[1]],
      [members[1], members[0]],
      [members[2], members[3]],
      [members[3], members[2]],
    ]),
  };
}

async function main() {
  const runtime = await startManagedRuntime({
    baseUrl: process.env.BETA_API_URL,
    spawnRuntime: !process.env.BETA_API_URL,
    port: process.env.BETA_TEST_PORT ?? 8821,
  });
  const socialSockets = [];

  try {
    const results = [];
    let socialRooms = [];
    let observationReportId = null;
    let governanceConflictStatus = null;
    let governanceExpectedTargets = new Map();
    let governanceSenders = [];
    const socialRoomEventCounts = new Map();

    if ((socialRoomsMode || socialGovernanceMode) && withObservation) {
      await enableObservation(runtime.baseUrl);
    }

    if (socialRoomsMode) {
      socialRooms = await setupSocialRooms(
        runtime,
        socialSockets,
        socialRoomEventCounts
      );
    }

    if (socialGovernanceMode) {
      const governance = await setupGovernanceRoom(
        runtime,
        socialSockets,
        socialRoomEventCounts
      );
      socialRooms = [governance.room];
      governanceSenders = governance.senders;
      governanceExpectedTargets = governance.expectedTargets;
    }

    for (let round = 0; round < rounds; round += 1) {
      const batch = Array.from({ length: concurrency }, async (_, index) => {
        if (socialRoomsMode || socialGovernanceMode) {
          const room = socialRooms[(round + index) % socialRooms.length];

          if (withObservation && index === 0) {
            await captureObservationSample(
              runtime.baseUrl,
              `${loadMode} round ${round}`
            );
          }

          const sourcePersonalityId = socialGovernanceMode
            ? governanceSenders[(round + index) % governanceSenders.length]
            : room.members[(round + index) % room.members.length];
          const targetPersonalityId = socialGovernanceMode
            ? governanceExpectedTargets.get(sourcePersonalityId)
            : room.members.find((memberId) => memberId !== sourcePersonalityId);
          const result = await expectJson(
            runtime.baseUrl,
            '/api/personality/rooms/message',
            {
              method: 'POST',
              body: {
                roomId: room.id,
                userId: `beta-load-room-user-${room.id}`,
                sourcePersonalityId,
                targetPersonalityId,
                message: socialGovernanceMode
                  ? `Governance load round=${round} slot=${index}: согласуй позицию только внутри своей коалиции.`
                  : `Social load round=${round} slot=${index}: согласуй короткий рабочий план и общий словарь.`,
              },
            }
          );

          return {
            round,
            slot: index,
            roomId: room.id,
            sourcePersonalityId,
            targetPersonalityId: targetPersonalityId ?? null,
            durationMs: result.durationMs,
            transcriptLength: result.json.transcript?.length ?? 0,
            deliveryCount: result.json.deliveries?.length ?? 0,
            deliveryTargets: (result.json.deliveries ?? []).map(
              (entry) => entry.targetPersonalityId
            ),
            expectedTarget:
              governanceExpectedTargets.get(sourcePersonalityId) ?? null,
          };
        }

        const personalityId =
          personalities[(round + index) % personalities.length];
        const userId = `beta-load-${round}-${index}`;
        const message = ultraMode
          ? `!ultra Бета-нагрузка round=${round} slot=${index}: собери краткий междисциплинарный план для новой исследовательской инициативы.`
          : `Бета-нагрузка round=${round} slot=${index}: расскажи кратко, что тебе сейчас интересно.`;
        const result = await expectJson(runtime.baseUrl, '/api/atman/chat', {
          method: 'POST',
          body: {
            message,
            userId,
            personalityId,
            history: [],
          },
        });

        let perRequestObservationReportId = null;

        if (withObservation) {
          await enableObservation(runtime.baseUrl);
          const observationReport = await expectJson(
            runtime.baseUrl,
            '/api/atman/observe/report?personalityId=default'
          );
          perRequestObservationReportId =
            observationReport.json.report?.id ?? null;
          await expectJson(runtime.baseUrl, '/api/atman/observe/control', {
            method: 'POST',
            body: {
              personalityId: 'default',
              action: 'off',
            },
          });
        }

        return {
          round,
          slot: index,
          personalityId,
          durationMs: result.durationMs,
          ultraActive: result.json.report?.ultra?.active ?? false,
          sessionKey:
            result.json.report?.ultra?.sessionId ?? result.json.sessionKey,
          responseLength: String(result.json.response ?? '').length,
          observationReportId: perRequestObservationReportId,
        };
      });

      results.push(...(await Promise.all(batch)));
    }

    if (socialGovernanceMode) {
      const governanceRoom = socialRooms[0];
      const blocked = await request(
        runtime.baseUrl,
        '/api/personality/rooms/message',
        {
          method: 'POST',
          body: {
            roomId: governanceRoom.id,
            userId: 'beta-load-governance-conflict',
            sourcePersonalityId: governanceRoom.members[0],
            targetPersonalityId: governanceRoom.members[2],
            message: 'Попытка прямого сообщения через активный конфликт.',
          },
        }
      );
      governanceConflictStatus = blocked.status;
    }

    if ((socialRoomsMode || socialGovernanceMode) && withObservation) {
      observationReportId = await finishObservation(runtime.baseUrl);
    }

    const health = await expectJson(runtime.baseUrl, '/api/health');
    const summary = {
      concurrency,
      rounds,
      mode: socialGovernanceMode
        ? 'social-governance'
        : socialRoomsMode
          ? 'social-rooms'
          : ultraMode
            ? 'ultra'
            : 'personality-chat',
      withObservation,
      totalRequests: results.length,
      averageDurationMs: mean(results.map((entry) => entry.durationMs)),
      p95DurationMs: percentile(
        results.map((entry) => entry.durationMs),
        0.95
      ),
      maxDurationMs: Math.max(...results.map((entry) => entry.durationMs)),
      overFiveSeconds: results.filter((entry) => entry.durationMs > 5000)
        .length,
      websocketEventCount: [...socialRoomEventCounts.values()].reduce(
        (sum, value) => sum + Number(value ?? 0),
        0
      ),
      rooms: socialRooms.map((room) => room.id),
      observationReportId,
      healthStatus: health.json.status,
      governanceConflictStatus,
    };
    const payload = {
      kind: 'pantheon-beta-load-test',
      createdAt: new Date().toISOString(),
      baseUrl: runtime.baseUrl,
      summary,
      results,
    };
    const reportFile = await writeJsonReport(
      `beta-load-${runtime.tag}.json`,
      payload
    );
    console.log(JSON.stringify({ summary, reportFile }, null, 2));

    if (socialGovernanceMode) {
      const invalidCoalitionDeliveries = results.filter(
        (entry) =>
          entry.expectedTarget &&
          (entry.deliveryCount !== 1 ||
            entry.deliveryTargets?.[0] !== entry.expectedTarget)
      );

      if (
        invalidCoalitionDeliveries.length > 0 ||
        governanceConflictStatus !== 409
      ) {
        process.exitCode = 1;
      }
    }

    if (summary.overFiveSeconds > 0 || summary.healthStatus !== 'healthy') {
      process.exitCode = 1;
    }
  } finally {
    socialSockets.forEach((socket) => socket.close());
    await runtime.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
