import { execFile } from 'node:child_process';
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');
const binDir = path.join(repoRoot, 'node_modules', '.bin');

function resolveBin(name) {
  return path.join(binDir, process.platform === 'win32' ? `${name}.cmd` : name);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        ...(options.env ?? {}),
      },
      timeout: options.timeout ?? 120000,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    if (options.allowFailure) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
        code: error.code ?? 1,
      };
    }
    throw error;
  }
}

async function withTempDir(prefix, runner) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));

  try {
    return await runner(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testFormatterAndEditorConfig() {
  const editorConfig = await readFile(
    path.join(repoRoot, '.editorconfig'),
    'utf8'
  );
  assert(
    editorConfig.includes('indent_style = space'),
    '.editorconfig must enforce spaces'
  );
  assert(
    editorConfig.includes('insert_final_newline = true'),
    '.editorconfig must enforce final newlines'
  );

  return withTempDir('dots2-format-', async (dir) => {
    const filePath = path.join(dir, 'fixture.ts');
    await writeFile(filePath, 'export   const  answer={ value:42}\n', 'utf8');
    await run(resolveBin('prettier'), [
      '--config',
      path.join(repoRoot, '.prettierrc.json'),
      '--write',
      filePath,
    ]);
    const content = await readFile(filePath, 'utf8');
    assert(
      content === 'export const answer = { value: 42 };\n',
      'Formatter should normalize spacing and newline'
    );
    return { filePath, content };
  });
}

async function testTypecheckFailure() {
  return withTempDir('dots2-type-', async (dir) => {
    const filePath = path.join(dir, 'bad-types.ts');
    await writeFile(filePath, "const answer: number = 'oops';\n", 'utf8');
    const result = await run(
      resolveBin('tsc'),
      ['--pretty', 'false', '--noEmit', filePath],
      {
        allowFailure: true,
        cwd: dir,
      }
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert(
      result.code !== 0,
      'Typecheck should fail for incompatible assignment'
    );
    assert(
      /TS2322|Type 'string' is not assignable to type 'number'/.test(output),
      'Typecheck failure should explain the mismatch'
    );
    return { output };
  });
}

async function prepareGitClone() {
  const cloneDir = await mkdtemp(path.join(os.tmpdir(), 'dots2-clone-'));
  await cp(repoRoot, cloneDir, {
    recursive: true,
    filter(source) {
      const relativePath = path.relative(repoRoot, source);

      if (!relativePath) {
        return true;
      }

      return ![
        '.git',
        'node_modules',
        'dist',
        'data',
        'server/testing/data',
      ].some(
        (blocked) =>
          relativePath === blocked ||
          relativePath.startsWith(`${blocked}${path.sep}`)
      );
    },
  });
  await symlink(
    path.join(repoRoot, 'node_modules'),
    path.join(cloneDir, 'node_modules'),
    'dir'
  );
  await run('git', ['init'], { cwd: cloneDir });
  await run('git', ['config', 'user.name', 'Quality Bot'], { cwd: cloneDir });
  await run('git', ['config', 'user.email', 'quality@example.test'], {
    cwd: cloneDir,
  });
  await run('git', ['add', '.'], { cwd: cloneDir });
  await run(
    'git',
    ['commit', '--no-verify', '-m', 'chore(tooling): baseline'],
    {
      cwd: cloneDir,
    }
  );
  await run('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: cloneDir,
  });
  await chmod(path.join(cloneDir, '.githooks', 'pre-commit'), 0o755);
  await chmod(path.join(cloneDir, '.githooks', 'commit-msg'), 0o755);
  await chmod(path.join(cloneDir, '.githooks', 'pre-push'), 0o755);
  return cloneDir;
}

async function testPreCommitHook() {
  const cloneDir = await prepareGitClone();

  try {
    const target = path.join(cloneDir, 'README.md');
    const original = await readFile(target, 'utf8');
    await writeFile(target, `${original.trimEnd()}    \n`, 'utf8');
    await run('git', ['add', 'README.md'], { cwd: cloneDir });
    const result = await run(
      'git',
      ['commit', '-m', 'chore(tooling): verify pre-commit'],
      {
        cwd: cloneDir,
        allowFailure: true,
      }
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert(
      result.code !== 0,
      'pre-commit hook should block badly formatted changes'
    );
    assert(
      /format:check|pre-commit/.test(output),
      'pre-commit failure should mention quality checks'
    );
    return { output };
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }
}

async function testCommitMessageConvention() {
  const cloneDir = await prepareGitClone();

  try {
    const bad = await run(
      'git',
      ['commit', '--allow-empty', '-m', 'update code'],
      {
        cwd: cloneDir,
        allowFailure: true,
      }
    );
    const badOutput = `${bad.stdout}\n${bad.stderr}`;
    assert(
      bad.code !== 0,
      'commitlint should reject a non-conventional message'
    );
    assert(
      /\[commit-msg\] commitlint|subject-empty|type-empty|type-enum/i.test(
        badOutput
      ),
      'commitlint should explain the invalid message'
    );

    const good = await run(
      'git',
      ['commit', '--allow-empty', '-m', 'chore(tooling): verify commitlint'],
      {
        cwd: cloneDir,
      }
    );
    const goodOutput = `${good.stdout}\n${good.stderr}`;
    assert(
      /verify commitlint/.test(goodOutput),
      'valid conventional commit should be accepted'
    );
    return { badOutput, goodOutput };
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }
}

async function testDependencyCruiser() {
  return withTempDir('dots2-deps-', async (dir) => {
    await mkdir(path.join(dir, 'static'), { recursive: true });
    await mkdir(path.join(dir, 'server'), { recursive: true });
    await writeFile(
      path.join(dir, 'server', 'runtime.js'),
      'export const runtime = true;\n',
      'utf8'
    );
    await writeFile(
      path.join(dir, 'static', 'bad.js'),
      "import { runtime } from '../server/runtime.js';\nconsole.log(runtime);\n",
      'utf8'
    );

    const result = await run(
      resolveBin('depcruise'),
      [
        '--config',
        path.join(repoRoot, '.dependency-cruiser.cjs'),
        'static',
        'server',
      ],
      {
        cwd: dir,
        allowFailure: true,
      }
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert(
      result.code !== 0,
      'dependency-cruiser should reject static -> server imports'
    );
    assert(
      /static-no-server-imports/.test(output),
      'dependency-cruiser output should name the violated rule'
    );
    return { output };
  });
}

async function testSecurityAudit() {
  const liveAudit = await run('npm', ['run', 'audit:ci'], { cwd: repoRoot });

  return withTempDir('dots2-audit-', async (dir) => {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify(
        {
          name: 'audit-probe',
          private: true,
          version: '0.0.0',
          dependencies: {
            lodash: '4.17.19',
          },
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    await run('npm', ['install', '--package-lock-only'], {
      cwd: dir,
      timeout: 120000,
    });
    const vulnerable = await run(
      'npm',
      ['audit', '--audit-level=high', '--json'],
      {
        cwd: dir,
        allowFailure: true,
        timeout: 120000,
      }
    );
    const output = `${vulnerable.stdout}\n${vulnerable.stderr}`;
    assert(
      vulnerable.code !== 0,
      'npm audit should fail for a known vulnerable dependency'
    );
    assert(
      /vulnerabilities|high|critical/i.test(output),
      'npm audit should report a vulnerability summary'
    );
    return { liveAudit: liveAudit.stdout, output };
  });
}

async function testGovernanceDocs() {
  const requiredFiles = [
    'CONTRIBUTING.md',
    'CODE_STYLE.md',
    '.github/pull_request_template.md',
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/ISSUE_TEMPLATE/feature_request.md',
    '.github/dependabot.yml',
  ];

  for (const relativePath of requiredFiles) {
    const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
    assert(content.trim().length > 0, `${relativePath} must not be empty`);
  }

  const prTemplate = await readFile(
    path.join(repoRoot, '.github', 'pull_request_template.md'),
    'utf8'
  );
  assert(
    prTemplate.includes('Validation'),
    'PR template should contain a validation checklist'
  );

  const contributing = await readFile(
    path.join(repoRoot, 'CONTRIBUTING.md'),
    'utf8'
  );
  assert(
    /git config core\.hooksPath \.githooks/.test(contributing),
    'CONTRIBUTING.md should explain hook installation'
  );
  return { checkedFiles: requiredFiles.length };
}

async function main() {
  const checks = [
    ['formatter-and-editorconfig', testFormatterAndEditorConfig],
    ['typecheck-negative', testTypecheckFailure],
    ['pre-commit-hook', testPreCommitHook],
    ['commit-message-convention', testCommitMessageConvention],
    ['dependency-cruiser-boundaries', testDependencyCruiser],
    ['security-audit', testSecurityAudit],
    ['governance-docs-and-templates', testGovernanceDocs],
  ];
  const results = [];

  for (const [name, runner] of checks) {
    const startedAt = Date.now();
    const details = await runner();
    results.push({
      name,
      passed: true,
      durationMs: Date.now() - startedAt,
      details,
    });
  }

  console.log(
    JSON.stringify(
      { total: results.length, passed: results.length, results },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error)
  );
  process.exit(1);
});
