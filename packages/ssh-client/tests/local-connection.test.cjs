const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { LocalConnection, GitCommands, RepositoryFiles, runGit } = require('../dist');
const { joinRepositoryPath, normalizeRepositoryPath } = require('../dist/repository-path');

function fixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'alune-local-transport-')),
  );
  const repo = path.join(root, "repo ' $literal");
  fs.mkdirSync(repo);
  const config = path.join(root, 'empty.gitconfig');
  fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.hooksPath', '.git/hooks');
  return { root, repo, git, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('local commands use literal argv and bounded, byte-preserving output', async () => {
  const f = fixture();
  try {
    const connection = new LocalConnection();
    const git = new GitCommands(connection);
    const name = "-literal ' $HOME [file].txt";
    const payload = Buffer.from([0, 255, 254, 10, 128]);
    fs.writeFileSync(path.join(f.repo, name), payload);
    await git.stage(f.repo, [name]);
    assert.equal((await git.commit(f.repo, 'fixture')).exitCode, 0);
    const result = await runGit(connection, f.repo, ['show', `HEAD:${name}`], undefined, {
      binary: true,
    });
    assert.deepEqual(result.stdoutBytes, payload);
    await assert.rejects(connection.execCommand('echo forbidden'), /结构化/);
    await assert.rejects(
      runGit(connection, f.repo, ['show', `HEAD:${name}`], undefined, { strictUtf8: true }),
    );
    fs.writeFileSync(path.join(f.repo, 'large.txt'), 'a'.repeat(128 * 1024));
    await git.stage(f.repo, ['large.txt']);
    await git.commit(f.repo, 'large');
    await assert.rejects(
      runGit(connection, f.repo, ['show', 'HEAD:large.txt'], undefined, { maxOutputBytes: 1024 }),
      /exceeded the preview limit/,
    );
    const tree = await new RepositoryFiles(connection).list(f.repo, '');
    assert(tree.entries.some((item) => item.name === name));
    assert(!tree.entries.some((item) => item.name === '.git'));
  } finally {
    f.close();
  }
});

test('cancellation stops a real commit hook and leaves staged data available', async (t) => {
  const f = fixture();
  const trace = [];
  const traceStart = Date.now();
  if (process.platform === 'win32') {
    const childProcess = require('node:child_process');
    const spawn = childProcess.spawn;
    t.mock.method(childProcess, 'spawn', (program, args, options) => {
      const helper = program === 'powershell.exe' || program === 'taskkill.exe';
      if (program === 'powershell.exe') {
        args = [...args];
        const index = args.indexOf('-EncodedCommand') + 1;
        const script = Buffer.from(args[index], 'base64')
          .toString('utf16le')
          .replace(
            '$snapshot = @(Get-CimInstance Win32_Process)',
            () => `$snapshot = @(Get-CimInstance Win32_Process)
$snapshot | Where-Object { $_.Name -match '^(git|sh|bash|sleep)\\.exe$' } | Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json -Compress`,
          )
          .replace(
            '[array]::Reverse($targets)',
            () => `Write-Output ("targets: " + ($targets -join ','))
[array]::Reverse($targets)`,
          )
          .replace(
            '$msysRows = @(& $msysPs -W)',
            () => `$msysRows = @(& $msysPs -W)
Write-Output ($msysRows -join "\\n")`,
          );
        args[index] = Buffer.from(script, 'utf16le').toString('base64');
      }
      const child = spawn(
        program,
        args,
        helper ? { ...options, stdio: ['ignore', 'pipe', 'pipe'] } : options,
      );
      const record = (event) =>
        trace.push(`${Date.now() - traceStart}ms ${program} ${child.pid}: ${event}`);
      record('spawn');
      child.on('error', (error) => record(error.message));
      child.on('exit', (code, signal) => record(`exit ${code} ${signal}`));
      child.on('close', (code, signal) => record(`close ${code} ${signal}`));
      if (helper) {
        child.stdout.on('data', (chunk) => record(`stdout ${chunk}`));
        child.stderr.on('data', (chunk) => record(`stderr ${chunk}`));
      }
      return child;
    });
  }
  try {
    fs.writeFileSync(path.join(f.repo, 'tracked.txt'), 'preserve\n');
    f.git('add', '--', 'tracked.txt');
    const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nprintf ready > .alune-hook-ready\nsleep 30\n', {
      mode: 0o755,
    });
    const controller = new AbortController();
    const connection = new LocalConnection(controller.signal);
    const command = connection.execGit(f.repo, ['commit', '-m', 'cancel me']);
    const failure = assert.rejects(command, /cancel fixture/);
    const startedAt = Date.now();
    while (!fs.existsSync(path.join(f.repo, '.alune-hook-ready'))) {
      if (Date.now() - startedAt > 8000) throw new Error('pre-commit hook did not start');
      await new Promise((done) => setTimeout(done, 20));
    }
    controller.abort(new Error('cancel fixture'));
    await failure;
    assert(Date.now() - startedAt < 12_000);
    assert.equal(f.git('diff', '--cached', '--name-only').trim(), 'tracked.txt');
    assert.equal(fs.readFileSync(path.join(f.repo, 'tracked.txt'), 'utf8'), 'preserve\n');
    assert(!fs.existsSync(path.join(f.repo, '.git', 'index.lock')));
  } finally {
    if (trace.length) t.diagnostic(trace.join('\n'));
    f.close();
  }
});

test('local commands discard inherited repository selectors', async () => {
  const f = fixture();
  const other = fixture();
  const saved = process.env.GIT_DIR;
  try {
    process.env.GIT_DIR = path.join(other.repo, '.git');
    const result = await runGit(new LocalConnection(), f.repo, ['rev-parse', '--show-toplevel']);
    assert.equal(fs.realpathSync.native(result.stdout.trim()), fs.realpathSync.native(f.repo));
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
    f.close();
    other.close();
  }
});

test('shared path helpers preserve UNC shares, drive paths and POSIX literal backslashes', () => {
  assert.equal(
    joinRepositoryPath('//server/share/repo', 'src', 'file.txt'),
    '//server/share/repo/src/file.txt',
  );
  assert.equal(normalizeRepositoryPath('//server/share/repo/../other'), '//server/share/other');
  assert.equal(joinRepositoryPath('C:/repo', 'src/file.txt'), 'C:/repo/src/file.txt');
  assert.equal(joinRepositoryPath('/repo', 'back\\slash.txt'), '/repo/back\\slash.txt');
});
