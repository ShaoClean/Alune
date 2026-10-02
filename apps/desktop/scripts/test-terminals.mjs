import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'alune-terminal-desktop-'));
const packagedRelative =
  process.platform === 'darwin'
    ? `${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Alune.app/Contents/MacOS/Alune`
    : process.platform === 'win32'
      ? 'win-unpacked/Alune.exe'
      : 'linux-unpacked/alune';
const packaged =
  process.env.ALUNE_TEST_EXECUTABLE ||
  (process.argv.includes('--packaged') ? path.resolve('release', packagedRelative) : undefined);
const env = { ...process.env, ALUNE_SMOKE_DIR: directory, ALUNE_TERMINAL_SMOKE: '1' };
if (process.platform !== 'win32') env.SHELL = '/bin/sh';
delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(
    packaged || require('electron'),
    [...(packaged ? [] : ['dist/app']), '--smoke-test'],
    { env, stdio: 'inherit' },
  );
  const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  }).finally(() => clearTimeout(timer));
  if (code) throw new Error('Terminal desktop smoke failed: ' + code);
} finally {
  await rm(directory, { recursive: true, force: true });
}
