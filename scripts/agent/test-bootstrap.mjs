// Exercise the generated wire commands under the platform's native login shell,
// with binary stdin, no system SSH access and no dependency on the workspace build.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapCommands } from '../../packages/agent/src/adapters/ssh/commands.ts';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-bootstrap-')),
  home = path.join(root, 'SSH login 中文');
fs.mkdirSync(home);
try {
  const data = randomBytes(1 << 20);
  fs.writeFileSync(path.join(root, 'asset'), data);
  const archive = execFileSync('tar', ['-czf', '-', 'asset'], { cwd: root, maxBuffer: 2 << 20 });
  const id = randomUUID(),
    sha = createHash('sha256').update(archive).digest('hex');
  const c = bootstrapCommands(process.platform === 'win32', sha, id);
  const run = (step, input) => {
    console.log('bootstrap:', step);
    return execSync(c[step], {
      cwd: home,
      input,
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 30000,
    });
  };
  assert.equal(run('installed').length, 0);
  run('upload', archive);
  assert.equal(run('installed').toString(), 'present');
  run('prepare');
  assert.deepEqual(fs.readFileSync(path.join(home, '.alune-ssh', 'run-' + id, 'asset')), data);
  run('clean');
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 4 });
}
