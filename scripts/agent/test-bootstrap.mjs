// Exercise the generated wire commands under the platform's native login shell,
// with binary stdin, no system SSH access and no dependency on the workspace build.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execSync, execFileSync, spawn } from 'node:child_process';
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
    return execSync(step === 'upload' ? c.upload(archive.length) : c[step], {
      cwd: home,
      input,
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 30000,
    });
  };
  assert.equal(run('installed').length, 0);
  if (process.platform === 'win32') {
    // Windows OpenSSH may keep stdin open after delivering the last archive byte.
    const [powershell, ...args] = c.upload(archive.length).split(' ');
    const child = spawn(powershell, args, {
      cwd: home,
      stdio: ['pipe', 'ignore', 'inherit'],
      timeout: 30000,
    });
    const finished = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    child.stdin.write(archive);
    try {
      assert.equal(await finished, 0);
    } finally {
      child.stdin.destroy();
    }
  } else {
    run('upload', archive);
  }
  assert.equal(run('installed').toString(), 'present');
  run('prepare');
  assert.deepEqual(fs.readFileSync(path.join(home, '.alune-ssh', 'run-' + id, 'asset')), data);
  const folder = path.join(home, '.alune-ssh', 'run-' + id);
  const node = path.join(
    folder,
    process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node',
  );
  fs.mkdirSync(path.dirname(node), { recursive: true });
  if (process.platform === 'win32') fs.copyFileSync(process.execPath, node);
  else fs.symlinkSync(process.execPath, node);
  const entry = path.join(folder, 'node_modules/@alune/agent/bin/alune-agent.cjs');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, 'process.stdin.pipe(process.stdout)');
  const frame = Buffer.from('{"jsonrpc":"2.0","id":"test:1","result":"中文"}\n');
  assert.deepEqual(run('serve', frame), frame);
  assert.equal(fs.existsSync(folder), false);
  run('prepare');
  run('clean');
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 4 });
}
