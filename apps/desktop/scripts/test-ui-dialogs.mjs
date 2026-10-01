// Run after starting the built website preview: npm run website:preview -- --port 4321
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const profile = await mkdtemp(path.join(tmpdir(), 'alune-ui-dialogs-153-'));
const env = { ...process.env, ALUNE_DIALOG_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(
    require('electron'),
    [fileURLToPath(new URL('../test/ui-dialog-renderer.cjs', import.meta.url))],
    { env, stdio: 'inherit' },
  );
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  }).finally(() => clearTimeout(timeout));
} finally {
  await rm(profile, { recursive: true, force: true });
}
