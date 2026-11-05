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
let peer;
try {
  if (env.ALUNE_DESKTOP_EXECUTOR === 'agent')
    env.ALUNE_CANDIDATE_FIXTURE = JSON.stringify(
      (await import('./candidate-fixture.mjs')).legacyFixture(dataDir),
    );
  if (env.ALUNE_DESKTOP_EXECUTOR === 'agent') {
    peer = await (await import('./candidate-review-fixture.mjs')).reviewFixture(dataDir);
    Object.assign(env, peer.env);
  }
  if (env.ALUNE_CANDIDATE_FIXTURE) {
    env.GIT_CONFIG_GLOBAL = path.join(dataDir, 'empty.gitconfig');
    env.GIT_CONFIG_NOSYSTEM = '1';
  }
  for (const phase of ['write', 'restore']) {
    const child = spawn(executable, [...args, '--smoke-test'], {
      stdio: 'inherit',
      env: { ...env, ALUNE_SMOKE_PHASE: phase },
    });
    const timeout = setTimeout(
      () => {
        console.error(`Desktop smoke ${phase} timed out`);
        child.kill('SIGKILL');
      },
      env.ALUNE_DESKTOP_EXECUTOR === 'agent' ? 300000 : 150000,
    );
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    }).finally(() => clearTimeout(timeout));
    process.exitCode = code;
    if (code !== 0) break;
    if (peer && phase === 'write') {
      peer.verify();
      await (await import('./prepare-smoke-vault.mjs')).prepareSmokeVault(dataDir);
      env.ALUNE_TEST_FILE_VAULT = '1';
    } else if (peer) {
      peer.verify();
      peer.verifyTokens();
      (await import('./prepare-smoke-vault.mjs')).checkTokenStorage(dataDir);
    }
  }
} finally {
  await peer?.close();
  await rm(dataDir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
}
