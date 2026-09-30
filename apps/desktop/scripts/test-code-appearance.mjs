import { cp, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');
const fixture = createRepository();
const root = await mkdtemp(path.join(tmpdir(), 'alune-code-appearance-'));
let remote;
try {
  fixture.write('example.ts', '// fixture\nexport const name = "Alune";\n'.repeat(120));
  fixture.write('example.py', '# fixture\nprint("Alune", 42)\n');
  fixture.write('example.json', '{"name":"Alune","count":42}\n');
  fixture.write('unknown.custom', 'Plain text <content>\n');
  fixture.write('large.ts', 'const value = "large fixture";\n'.repeat(10_000));
  remote = await startSSHServer();
  const appPath = path.join(root, 'app');
  await cp(fileURLToPath(new URL('../dist/app', import.meta.url)), appPath, { recursive: true });
  await rename(path.join(appPath, 'smoke.cjs'), path.join(appPath, 'smoke-original.cjs'));
  await cp(
    fileURLToPath(new URL('./code-files-smoke.cjs', import.meta.url)),
    path.join(appPath, 'code-files-smoke.cjs'),
  );
  await writeFile(
    path.join(appPath, 'smoke.cjs'),
    // Fail visibly instead of leaving Electron's native exception dialog waiting for input.
    "process.on('uncaughtException', error => { console.error(error); require('electron').app.exit(1); });\n" +
      "module.exports = Object.assign(require('./code-files-smoke.cjs'), require('./smoke-original.cjs'));\n",
  );
  const env = {
    ...process.env,
    ALUNE_SMOKE_DIR: path.join(root, 'data'),
    ALUNE_CODE_FIXTURE: JSON.stringify({ connection: remote.options, path: fixture.repo }),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [appPath, '--smoke-test'], { env, stdio: 'inherit' });
  const timer = setTimeout(() => {
    console.error('Code appearance desktop acceptance exceeded 60 seconds (local and SSH).');
    child.kill('SIGKILL');
  }, 60_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    if (code !== 0) throw new Error('Code appearance desktop acceptance failed: ' + code);
  } finally {
    clearTimeout(timer);
  }
} finally {
  await remote?.close();
  fixture.close();
  await rm(root, { recursive: true, force: true });
}
