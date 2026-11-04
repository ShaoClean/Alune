import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';

if (process.env.CI !== 'true')
  throw new Error('Native system-storage migration smoke runs only in an isolated CI account');

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const data = await mkdtemp(path.join(tmpdir(), 'alune-native-migration-'));
const env = {
  ...process.env,
  ALUNE_MIGRATION_FIXTURE: data,
  ALUNE_MIGRATION_NODE: process.execPath,
  ALUNE_MIGRATION_AGENT: path.join(root, 'packages/agent/bin/alune-agent.cjs'),
};
delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(
    require('electron'),
    [fileURLToPath(new URL('../dist/app/agent-migration-smoke.cjs', import.meta.url))],
    { env, stdio: 'inherit', detached: process.platform !== 'win32' },
  );
  const timer = setTimeout(() => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 10000,
        });
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }, 150000);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    clearTimeout(timer);
  }
} finally {
  await rm(data, { recursive: true, force: true });
}
