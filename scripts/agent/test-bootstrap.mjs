// Exercise the generated wire commands under the platform's native login shell,
// including Windows PowerShell 5.1 nested DefaultShell wrapping, no system SSH
// access and no dependency on the workspace build.
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
  const run = (cmd, input) =>
    execSync(cmd, {
      cwd: home,
      input,
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 30000,
    });
  const runFallbackUpload = async (usePsWrapper) => {
    if (process.platform === 'win32') {
      // Simulate Windows OpenSSH keeping stdin open after delivering the final line,
      // both directly and wrapped inside an outer PowerShell 5.1 DefaultShell.
      const wire = c.upload(archive.length);
      const child = usePsWrapper
        ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', wire], {
            cwd: home,
            stdio: ['pipe', 'ignore', 'inherit'],
            timeout: 30000,
          })
        : (() => {
            const [powershell, ...args] = wire.split(' ');
            return spawn(powershell, args, {
              cwd: home,
              stdio: ['pipe', 'ignore', 'inherit'],
              timeout: 30000,
            });
          })();
      const finished = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      for (let i = 0; i < archive.length; i += 48 * 1024) {
        child.stdin.write(archive.subarray(i, i + 48 * 1024).toString('base64') + '\n');
      }
      child.stdin.write('END\n');
      try {
        assert.equal(await finished, 0);
      } finally {
        child.stdin.destroy();
      }
    } else {
      run(c.upload(archive.length), archive);
    }
  };

  console.log('bootstrap: installed (empty)');
  assert.equal(run(c.installed).length, 0);
  assert.equal(run(c.verified).length, 0);

  // Exercise SFTP-style staging + commit + stale artifact pruning.
  console.log('bootstrap: commit part + prune stale');
  const baseDir = path.join(home, c.paths.base);
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, '0'.repeat(64) + '.tar.gz'), Buffer.from('stale'));
  fs.writeFileSync(path.join(baseDir, 'upload-stale.part'), Buffer.from('stale-part'));
  fs.writeFileSync(path.join(home, c.paths.part), archive);
  run(c.commit('part'));
  assert.equal(run(c.installed).toString(), 'present');
  assert.equal(run(c.verified).toString(), 'verified');
  assert.equal(fs.existsSync(path.join(baseDir, '0'.repeat(64) + '.tar.gz')), false);
  assert.equal(fs.existsSync(path.join(baseDir, 'upload-stale.part')), false);

  // Exercise exec fallback upload (including nested PS 5.1 DefaultShell on Windows).
  console.log('bootstrap: upload fallback');
  fs.rmSync(path.join(home, c.paths.archive));
  await runFallbackUpload(false);
  assert.equal(run(c.verified).toString(), 'verified');
  if (process.platform === 'win32') {
    console.log('bootstrap: upload fallback (nested PS 5.1)');
    fs.rmSync(path.join(home, c.paths.archive));
    await runFallbackUpload(true);
    assert.equal(run(c.verified).toString(), 'verified');
  }

  console.log('bootstrap: prepare');
  run(c.prepare);
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
  console.log('bootstrap: serve');
  assert.deepEqual(run(c.serve, frame), frame);
  assert.equal(fs.existsSync(folder), false);
  run(c.prepare);
  console.log('bootstrap: clean');
  run(c.clean);
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 4 });
}
