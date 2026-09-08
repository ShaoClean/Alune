import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dataDir = await mkdtemp(path.join(tmpdir(), 'remote-git-smoke-'));
const executable = process.env.REMOTE_GIT_TEST_EXECUTABLE || require('electron');
const args = process.env.REMOTE_GIT_TEST_EXECUTABLE ? [] : ['dist/app'];
const env = { ...process.env, REMOTE_GIT_SMOKE_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(executable, [...args, '--smoke-test'], { stdio: 'inherit', env });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  }).finally(() => clearTimeout(timeout));
  process.exitCode = code;
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
