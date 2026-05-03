import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');
const c8Bin = path.join(repoRoot, 'node_modules', 'c8', 'bin', 'c8.js');
const coverageGlobs = [
  '--all',
  '--include=server/agent-runtime.mjs',
  '--include=server/dialog/**/*.mjs',
  '--include=server/social/**/*.mjs',
  '--include=server/sandbox/**/*.mjs',
  '--include=server/multimodal/**/*.mjs',
  '--include=server/openapi/**/*.mjs',
  '--exclude=server/testing/**',
  '--exclude=server/**/data/**',
];
const coverageThresholds = {
  lines: '65',
  functions: '80',
  branches: '55',
  statements: '65',
};

async function runStep(label, command, args, env = {}) {
  process.stdout.write(`\n[runtime-coverage] ${label}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`
        )
      );
    });
  });
}

async function runCoverageCommand(label, args) {
  await runStep(label, 'node', args);
}

async function main() {
  const coverageDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dots2-runtime-coverage-')
  );

  await runStep('beta:test', 'node', ['server/testing/beta-test-runner.mjs'], {
    NODE_V8_COVERAGE: coverageDir,
  });
  await runStep('beta:admin', 'node', ['server/testing/admin-ui-beta.mjs'], {
    NODE_V8_COVERAGE: coverageDir,
  });
  await runStep(
    'beta:scenarios',
    'node',
    ['server/testing/personality-scenario-runner.mjs'],
    {
      NODE_V8_COVERAGE: coverageDir,
    }
  );
  await runStep(
    'beta:load social-governance',
    'node',
    ['server/testing/load-test.mjs'],
    {
      NODE_V8_COVERAGE: coverageDir,
      BETA_LOAD_MODE: 'social-governance',
      BETA_LOAD_CONCURRENCY: '2',
      BETA_LOAD_ROUNDS: '2',
    }
  );
  await runStep(
    'beta:load social-rooms+observation',
    'node',
    ['server/testing/load-test.mjs'],
    {
      NODE_V8_COVERAGE: coverageDir,
      BETA_LOAD_MODE: 'social-rooms',
      BETA_LOAD_WITH_OBSERVATION: 'true',
      BETA_LOAD_CONCURRENCY: '2',
      BETA_LOAD_ROUNDS: '2',
      BETA_LOAD_SOCIAL_ROOM_COUNT: '4',
      BETA_LOAD_SOCIAL_PERSONALITY_COUNT: '12',
    }
  );

  await runCoverageCommand('c8 report', [
    c8Bin,
    'report',
    '--temp-directory',
    coverageDir,
    '--reporter=text-summary',
    '--reporter=json-summary',
    ...coverageGlobs,
  ]);
  await runCoverageCommand('c8 check-coverage', [
    c8Bin,
    'check-coverage',
    '--temp-directory',
    coverageDir,
    '--lines',
    coverageThresholds.lines,
    '--functions',
    coverageThresholds.functions,
    '--branches',
    coverageThresholds.branches,
    '--statements',
    coverageThresholds.statements,
    ...coverageGlobs,
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
