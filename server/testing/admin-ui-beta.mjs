import { chromium } from 'playwright';

import {
  expectJson,
  startManagedRuntime,
  summarizeCases,
  withMeasuredCase,
  writeJsonReport,
} from './beta-utils.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForPreText(page, selector, expected) {
  await page.waitForFunction(
    ({ targetSelector, value }) => {
      const node = document.querySelector(targetSelector);
      return node && node.textContent && node.textContent.includes(value);
    },
    { targetSelector: selector, value: expected }
  );
}

async function main() {
  const runtime = await startManagedRuntime({
    baseUrl: process.env.BETA_API_URL,
    spawnRuntime: !process.env.BETA_API_URL,
    port: process.env.BETA_TEST_PORT ?? 8823,
  });
  const report = {
    kind: 'pantheon-admin-ui-beta-test',
    createdAt: new Date().toISOString(),
    baseUrl: runtime.baseUrl,
    runtime: {
      port: runtime.port,
      tag: runtime.tag,
      logFilePath: runtime.logFilePath,
      pid: runtime.pid ?? null,
    },
    cases: [],
  };
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${runtime.baseUrl}/admin.html`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    await withMeasuredCase(report, 'admin-ui', 'page-load', async () => {
      await page.waitForSelector('h1');
      const title = await page.textContent('h1');
      assert(
        /Администрирование системы/i.test(title ?? ''),
        'Admin page title is missing'
      );
      return { title };
    });

    await withMeasuredCase(report, 'admin-ui', 'startup-panels', async () => {
      await waitForPreText(page, '#bridgeStatusOutput', 'requestTimeoutMs');
      await waitForPreText(page, '#telegramStatusOutput', 'requestTimeoutMs');
      await waitForPreText(page, '#atmanStatusOutput', '"personality"');
      await waitForPreText(page, '#operatorAuditOutput', 'events');
      await waitForPreText(page, '#sandboxStatusOutput', 'browser');
      return {
        bridgeLoaded: true,
        telegramLoaded: true,
        atmanLoaded: true,
        auditLoaded: true,
        sandboxLoaded: true,
      };
    });

    await withMeasuredCase(
      report,
      'admin-ui',
      'sandbox-restart-card',
      async () => {
        await page.click('button:has-text("Refresh sandbox")');
        await waitForPreText(
          page,
          '#sandboxStatusOutput',
          'restartCountLastHour'
        );
        await page.click('button:has-text("Restart browser worker")');
        await waitForPreText(
          page,
          '#sandboxLogOutput',
          'sandbox-worker-restart'
        );

        return {
          sandboxStatus: await page.textContent('#sandboxStatusOutput'),
          sandboxLogs: await page.textContent('#sandboxLogOutput'),
        };
      }
    );

    await withMeasuredCase(
      report,
      'admin-ui',
      'social-room-live-panel',
      async () => {
        const peerId = `beta-admin-room-peer-${Date.now().toString(36)}`;

        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId: peerId,
            displayName: 'Beta Admin Room Peer',
          },
        });

        await page.fill('#socialRoomName', 'Admin Beta Room');
        await page.fill('#socialRoomMembers', peerId);
        await page.click('button:has-text("Create room")');
        await waitForPreText(page, '#socialRoomOutput', 'Admin Beta Room');
        await page.fill(
          '#socialRoomMessage',
          'Проверяем живой поток комнаты через admin UI.'
        );
        await page.fill('#socialRoomTarget', peerId);
        await page.click('button:has-text("Send room message")');
        await waitForPreText(
          page,
          '#socialRoomLiveOutput',
          'Проверяем живой поток комнаты через admin UI.'
        );

        return {
          roomOutput: await page.textContent('#socialRoomOutput'),
          liveOutput: await page.textContent('#socialRoomLiveOutput'),
        };
      }
    );

    await withMeasuredCase(
      report,
      'admin-ui',
      'social-coalitions-and-conflicts-panel',
      async () => {
        const peerId = `beta-admin-governance-peer-${Date.now().toString(36)}`;
        const roomName = `Admin Governance Room ${Date.now().toString(36)}`;
        const coalitionId = `admin-governance-coalition-${Date.now().toString(36)}`;

        await expectJson(runtime.baseUrl, '/api/atman/clone', {
          method: 'POST',
          body: {
            sourceId: 'default',
            personalityId: peerId,
            displayName: 'Beta Admin Governance Peer',
          },
        });

        const roomCreate = await expectJson(
          runtime.baseUrl,
          '/api/personality/rooms/create',
          {
            method: 'POST',
            body: {
              userId: 'admin-ui-test',
              personalityId: 'default',
              name: roomName,
              members: [peerId],
            },
          }
        );
        const roomId = roomCreate.json.room?.id;
        assert(roomId, 'Expected created room id for governance admin test');

        await page.click('button:has-text("Refresh governance rooms")');
        await page.selectOption('#socialGovernanceRoomSelect', roomId);
        await waitForPreText(page, '#socialGovernanceOutput', roomId);

        await page.fill('#socialCoalitionName', coalitionId);
        await page.click('button:has-text("Create coalition")');
        await page.waitForSelector(`[data-coalition-id="${coalitionId}"]`);

        let roomState = await expectJson(
          runtime.baseUrl,
          `/api/personality/rooms/${encodeURIComponent(roomId)}`
        );
        let coalition = (roomState.json.room?.channel?.coalitions || []).find(
          (entry) => entry.id === coalitionId
        );
        assert(coalition, 'Coalition should exist after admin UI creation');

        await page.selectOption(
          `[data-coalition-id="${coalitionId}"] select`,
          peerId
        );
        await page.click(
          `[data-coalition-id="${coalitionId}"] button:has-text("Add participant")`
        );

        roomState = await expectJson(
          runtime.baseUrl,
          `/api/personality/rooms/${encodeURIComponent(roomId)}`
        );
        coalition = (roomState.json.room?.channel?.coalitions || []).find(
          (entry) => entry.id === coalitionId
        );
        assert(
          coalition?.members?.includes(peerId),
          'Coalition member add should persist through admin UI'
        );

        await page.selectOption('#socialConflictInitiatorSelect', 'default');
        await page.selectOption('#socialConflictTargetSelect', peerId);
        await page.fill(
          '#socialConflictReason',
          'UI regression coverage for social governance panel.'
        );
        await page.click('button:has-text("Declare conflict")');

        roomState = await expectJson(
          runtime.baseUrl,
          `/api/personality/rooms/${encodeURIComponent(roomId)}`
        );
        let conflict = (roomState.json.room?.channel?.conflicts || []).find(
          (entry) =>
            entry.initiatorId === 'default' &&
            entry.targetId === peerId &&
            entry.active !== false
        );
        assert(conflict, 'Conflict should exist after admin UI declaration');

        await page.click(
          `[data-conflict-id="${conflict.id}"] button:has-text("Resolve")`
        );

        roomState = await expectJson(
          runtime.baseUrl,
          `/api/personality/rooms/${encodeURIComponent(roomId)}`
        );
        conflict = (roomState.json.room?.channel?.conflicts || []).find(
          (entry) => entry.id === conflict.id
        );
        assert(
          conflict && conflict.active === false,
          'Conflict should resolve from admin UI'
        );

        await page.click(
          `[data-coalition-id="${coalitionId}"] button:has-text("Delete coalition")`
        );

        roomState = await expectJson(
          runtime.baseUrl,
          `/api/personality/rooms/${encodeURIComponent(roomId)}`
        );
        assert(
          !(roomState.json.room?.channel?.coalitions || []).some(
            (entry) => entry.id === coalitionId
          ),
          'Coalition should delete from admin UI'
        );

        return {
          roomId,
          coalitionId,
          conflictId: conflict.id,
          governanceOutput: await page.textContent('#socialGovernanceOutput'),
        };
      }
    );

    await withMeasuredCase(
      report,
      'admin-ui',
      'atman-checkpoint-button',
      async () => {
        await page.click('button:has-text("Create checkpoint")');
        await waitForPreText(page, '#atmanCheckpointOutput', 'checkpoint');
        const output = await page.textContent('#atmanCheckpointOutput');
        return {
          output,
        };
      }
    );

    await withMeasuredCase(report, 'admin-ui', 'ultra-smoke-flow', async () => {
      await page.fill(
        '#atmanUltraPrompt',
        'Спроектируй экологичный жилой комплекс на 100 квартир с пассивным отоплением и семейными зонами'
      );
      await page.click('button:has-text("Start !ultra")');
      await waitForPreText(page, '#atmanUltraResponseOutput', '"active": true');
      await waitForPreText(
        page,
        '#atmanUltraSessionsOutput',
        'selectedExperts'
      );

      await page.fill(
        '#atmanUltraPrompt',
        'Добавь вывод по бюджету, рискам и этапам запуска проекта'
      );
      await page.click('button:has-text("Send turn")');
      await waitForPreText(
        page,
        '#atmanUltraResponseOutput',
        'contradictionResolutionScore'
      );

      await page.click('button:has-text("Stop !normal")');
      await waitForPreText(
        page,
        '#atmanUltraResponseOutput',
        '"active": false'
      );

      return {
        response: await page.textContent('#atmanUltraResponseOutput'),
        sessions: await page.textContent('#atmanUltraSessionsOutput'),
      };
    });

    await withMeasuredCase(
      report,
      'admin-ui',
      'media-generate-image',
      async () => {
        await page.fill(
          '#atmanMediaPrompt',
          'сад характеров под звездным небом'
        );
        await page.click('button:has-text("Generate image")');
        await waitForPreText(page, '#atmanMediaOutput', 'mimeType');
        await page.waitForFunction(() => {
          const artifact = window.__lastAtmanArtifact;
          return (
            artifact &&
            typeof artifact.mimeType === 'string' &&
            artifact.mimeType.startsWith('image/')
          );
        });
        const output = await page.textContent('#atmanMediaOutput');
        return {
          output,
        };
      }
    );

    await withMeasuredCase(
      report,
      'admin-ui',
      'refresh-bots-and-status',
      async () => {
        await page.click('button:has-text("Refresh bots")');
        await page.click('button:has-text("Refresh bridge")');
        await page.click('button:has-text("Refresh Telegram")');
        await waitForPreText(page, '#bridgeStatusOutput', 'deliveryCircuit');
        await waitForPreText(
          page,
          '#telegramStatusOutput',
          'pollTimeoutSeconds'
        );
        return {
          bridge: await page.textContent('#bridgeStatusOutput'),
          telegram: await page.textContent('#telegramStatusOutput'),
        };
      }
    );

    report.summary = summarizeCases(report.cases);
    const reportFile = await writeJsonReport(
      `beta-admin-${runtime.tag}.json`,
      report
    );
    console.log(
      JSON.stringify({ summary: report.summary, reportFile }, null, 2)
    );

    if (report.summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    await runtime.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
