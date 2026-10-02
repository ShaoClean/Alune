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
const root = await mkdtemp(path.join(tmpdir(), 'alune-diff-theme-'));
let remote;
try {
  const before =
    '// Alune\nexport function greet(name: string) {\n  /* A multiline\n     comment */\n  const count = 12;\n  return "Hello " + name;\n}\n';
  fixture.write('example.ts', before);
  fixture.write('example.py', '# Alune\nprint("old", 12)\n');
  fixture.write(
    'image.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'test: code theme baseline');
  fixture.write('example.ts', before.replace('12', '42').replace('"Hello "', '"Welcome "'));
  fixture.write('example.py', '# Alune\nprint("new", 42)\n');
  // A valid alternate PNG from the repository's existing image fixture.
  fixture.write(
    'image.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  remote = await startSSHServer();
  const appPath = path.join(root, 'app');
  await cp(fileURLToPath(new URL('../dist/app', import.meta.url)), appPath, { recursive: true });
  await rename(path.join(appPath, 'smoke.cjs'), path.join(appPath, 'smoke-original.cjs'));
  await cp(
    fileURLToPath(new URL('./diff-theme-smoke.cjs', import.meta.url)),
    path.join(appPath, 'diff-theme-smoke.cjs'),
  );
  await writeFile(
    path.join(appPath, 'smoke.cjs'),
    "process.on('uncaughtException', error => { console.error(error); require('electron').app.exit(1); });\nmodule.exports = Object.assign(require('./diff-theme-smoke.cjs'), require('./smoke-original.cjs'));\n",
  );
  for (const restart of ['0', '1']) {
    const env = {
      ...process.env,
      ALUNE_SMOKE_DIR: path.join(root, 'data'),
      ALUNE_DIFF_RESTART: restart,
      ALUNE_CODE_FIXTURE: JSON.stringify({ connection: remote.options, path: fixture.repo }),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [appPath, '--smoke-test'], { env, stdio: 'inherit' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolve(code ?? 1));
      });
      if (code !== 0) throw new Error(`Diff theme desktop acceptance failed (${restart}): ${code}`);
    } finally {
      clearTimeout(timer);
    }
  }
} finally {
  await remote?.close();
  fixture.close();
  await rm(root, { recursive: true, force: true });
}
