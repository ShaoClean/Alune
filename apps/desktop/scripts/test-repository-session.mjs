import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');
const root = await mkdtemp(path.join(tmpdir(), 'alune-tab-session-'));
let remote;
try {
  remote = await startSSHServer();
  const local = path.join(root, 'local');
  const worktree = path.join(root, 'worktree');
  const ssh = path.join(root, 'remote');
  await mkdir(local);
  const git = (...args) => execFileSync('git', args, { stdio: 'pipe' });
  git('init', '-q', '-b', 'main', local);
  await writeFile(path.join(local, 'README.md'), '# Session fixture\n');
  git('-C', local, 'add', '.');
  git(
    '-C',
    local,
    '-c',
    'user.name=Session test',
    '-c',
    'user.email=session@example.invalid',
    'commit',
    '-qm',
    'Initial',
  );
  git('-C', local, 'worktree', 'add', '-qb', 'feature', worktree);
  git('clone', '-q', local, ssh);
  const appPath = path.join(root, 'app');
  await cp(fileURLToPath(new URL('../dist/app', import.meta.url)), appPath, { recursive: true });
  await cp(path.join(appPath, 'smoke.cjs'), path.join(appPath, 'smoke-original.cjs'));
  await cp(
    fileURLToPath(new URL('./repository-session-smoke.cjs', import.meta.url)),
    path.join(appPath, 'repository-session-smoke.cjs'),
  );
  await writeFile(
    path.join(appPath, 'smoke.cjs'),
    "module.exports = Object.assign(require('./repository-session-smoke.cjs'), require('./smoke-original.cjs'));\n",
  );
  const data = path.join(root, 'data');
  await mkdir(data);
  const legacy = {
    appearance: { theme: 'dark', reduceMotion: true },
    treeOpen: true,
    layout: { sidebarWidth: 250, changesWidth: 360, diffMode: 'split' },
  };
  await writeFile(path.join(data, 'workspace.json'), JSON.stringify({ version: 1, state: legacy }));
  const env = {
    ...process.env,
    ALUNE_SMOKE_DIR: data,
    ALUNE_SESSION_FIXTURE: JSON.stringify({ local, worktree, ssh, connection: remote.options }),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const phase of [
    'write',
    'normal',
    'crash-close',
    'crash-open',
    'crash-reorder',
    'crash-batch',
    'crash-all',
    'empty',
    'delete',
    'pruned',
    'offline',
  ]) {
    if (phase === 'offline') {
      await remote.close();
      remote = null;
    }
    const child = spawn(require('electron'), [appPath, '--smoke-test'], {
      env: { ...env, ALUNE_SESSION_PHASE: phase },
      stdio: 'inherit',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    }).finally(() => clearTimeout(timer));
    if (phase.startsWith('crash-')) assert.equal(result.signal, 'SIGKILL', phase);
    else assert.equal(result.code, 0, phase);
    // The expectation is written by the smoke only after its scenario has run.
    const state = JSON.parse(await readFile(path.join(data, 'session-test.json'), 'utf8'));
    assert.equal(state.phase, phase, 'a timeout must not count as a successful forced exit');
    const saved = JSON.parse(await readFile(path.join(data, 'workspace.json'), 'utf8'));
    assert.equal(saved.version, 1);
    assert.deepEqual(saved.state.appearance, legacy.appearance);
    assert.equal(saved.state.layout.sidebarWidth, 250);
    assert.equal(saved.state.layout.diffMode, 'split');
    if (phase !== 'delete')
      assert.deepEqual(saved.state.repositorySession, state.expected, phase + ' disk session');
  }
  console.log('Repository session desktop acceptance: 11 process runs passed.');
} finally {
  await remote?.close();
  await rm(root, { recursive: true, force: true });
}
