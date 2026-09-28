import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'alune-electron-proxy-'));
const env = { ...process.env, ALUNE_PROXY_TEST_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(
    require('electron'),
    [fileURLToPath(new URL('../test/proxy-electron.cjs', import.meta.url))],
    {
      stdio: 'inherit',
      env,
    },
  );
  const timer = setTimeout(() => child.kill(), 60_000);
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  }).finally(() => clearTimeout(timer));
  process.exitCode = status;
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
