import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const runtime = path.join(root, 'apps/desktop/dist/agent-runtime');
const harness = path.join(data, 'harness');
const env = {
  ...process.env,
  ALUNE_MIGRATION_FIXTURE: data,
  ALUNE_MIGRATION_NODE: path.join(runtime, process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node'),
  ALUNE_MIGRATION_AGENT: path.join(runtime, 'node_modules/@alune/agent/bin/alune-agent.cjs'),
};
delete env.ELECTRON_RUN_AS_NODE;
try {
  await mkdir(harness);
  await writeFile(path.join(harness, 'package.json'), JSON.stringify({
    name: 'alune-native-migration-fixture', private: true,
    dependencies: { '@alune/agent': '*', 'better-sqlite3': '*' },
  }));
  await cp(path.join(runtime, 'node_modules'), path.join(harness, 'node_modules'), { recursive: true });
  for (const name of ['agent-migration-smoke.cjs', 'ai-secret-storage.cjs', 'legacy-agent-secrets.cjs'])
    await cp(path.join(root, 'apps/desktop/src', name), path.join(harness, name));
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  execFileSync(process.execPath, [
    path.join(root, 'node_modules/@electron/rebuild/lib/cli.js'),
    '--force', '--only', 'better-sqlite3', '--types', 'prod',
    '--version', manifest.devDependencies.electron, '--module-dir', harness,
  ], { stdio: 'inherit' });
  const child = spawn(
    require('electron'),
    [path.join(harness, 'agent-migration-smoke.cjs')],
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
