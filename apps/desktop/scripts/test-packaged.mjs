import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const relative = process.platform === 'darwin'
  ? `${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Alune.app/Contents/MacOS/Alune`
  : process.platform === 'win32' ? 'win-unpacked/Alune.exe' : 'linux-unpacked/alune';
const child = spawn(process.execPath, ['scripts/smoke.mjs'], {
  cwd: desktop, stdio: 'inherit',
  env: { ...process.env, ALUNE_TEST_EXECUTABLE: path.join(desktop, 'release', relative) },
});
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
