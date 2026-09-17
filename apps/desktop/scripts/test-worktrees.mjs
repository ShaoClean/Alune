import { cp, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
  createWorktreeRepository,
} = require('../../../packages/ssh-client/tests/helpers/worktree-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');
const fixture = createWorktreeRepository();
const root = await mkdtemp(path.join(tmpdir(), 'remote-git-worktree-desktop-'));
let remote;
try {
  remote = await startSSHServer();
  const appPath = path.join(root, 'app');
  // Use a disposable staged app, keeping both the normal smoke suite and user data intact.
  await cp(fileURLToPath(new URL('../dist/app', import.meta.url)), appPath, { recursive: true });
  await rename(path.join(appPath, 'smoke.cjs'), path.join(appPath, 'smoke-original.cjs'));
  await cp(
    fileURLToPath(new URL('./worktrees-smoke.cjs', import.meta.url)),
    path.join(appPath, 'worktrees-smoke.cjs'),
  );
  await writeFile(
    path.join(appPath, 'smoke.cjs'),
    "module.exports = Object.assign(require('./worktrees-smoke.cjs'), require('./smoke-original.cjs'));\n",
  );
  const env = {
    ...process.env,
    REMOTE_GIT_SMOKE_DIR: path.join(root, 'data'),
    REMOTE_GIT_WORKTREE_FIXTURE: JSON.stringify({ connection: remote.options, path: fixture.repo }),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [appPath, '--smoke-test'], { env, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    if (code !== 0) throw new Error('Worktree desktop acceptance failed: ' + code);
  } finally {
    clearTimeout(timer);
  }
} finally {
  await remote?.close();
  fixture.close();
  await rm(root, { recursive: true, force: true });
}
