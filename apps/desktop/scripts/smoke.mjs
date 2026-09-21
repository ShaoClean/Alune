import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dataDir = await mkdtemp(path.join(tmpdir(), 'alune-smoke-'));
const executable = process.env.ALUNE_TEST_EXECUTABLE || require('electron');
const args = process.env.ALUNE_TEST_EXECUTABLE ? [] : ['dist/app'];
const env = { ...process.env, ALUNE_SMOKE_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
try {
  for (const phase of ['write', 'restore']) {
    const child = spawn(executable, [...args, '--smoke-test'], { stdio: 'inherit', env: { ...env, ALUNE_SMOKE_PHASE: phase } });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    }).finally(() => clearTimeout(timeout));
    process.exitCode = code;
    if (code !== 0) break;
  }
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
