import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, exec } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runtimeCommands } from '../../packages/agent/dist/adapters/ssh/commands.js';
import { PROTOCOL_VERSION } from '../../packages/protocol/dist/index.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent bootstrap 中文 '));
const pkg = path.join(home, 'package');
const win = process.platform === 'win32';
const target = process.platform + '-' + process.arch;
const run = (cmd, publish = true) => {
  const result = promisify(exec)(cmd, {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, no_proxy: '*', NO_PROXY: '*' },
    timeout: 30000,
  });
  result.child.stdin.on('error', () => {});
  result.child.stdin.end(publish ? 'publish\n' : '');
  return result;
};
let downloads = 0;
let archive;
const server = http.createServer((_req, res) => {
  downloads++;
  res.end(archive);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'runtime/bin'), { recursive: true });
  if (!win) fs.symlinkSync(process.execPath, path.join(pkg, 'runtime/bin/node'));
  function release(version) {
    const entry = path.join(pkg, 'bin', win ? 'alune-agent.cmd' : 'alune-agent');
    const json = JSON.stringify({ name: 'alune-agent', version, protocol: PROTOCOL_VERSION });
    fs.writeFileSync(
      entry,
      win ? '@echo off\r\necho ' + json + '\r\n' : "#!/bin/sh\nprintf '%s\\n' '" + json + "'\n",
      { mode: 0o755 },
    );
    archive = execFileSync('tar', ['-czf', '-', 'bin', 'runtime'], { cwd: pkg });
    const bundle = {
      version,
      target,
      sha256: createHash('sha256').update(archive).digest('hex'),
      url: 'http://127.0.0.1:' + server.address().port + '/archive',
    };
    return (proxy) => runtimeCommands(bundle, randomUUID(), proxy);
  }
  const first = release('1.0.0');
  await assert.rejects(run(first('blocked').install), /forwarding blocked/);
  assert.equal(downloads, 0);
  await Promise.all([run(first().install), run(first().install)]);
  assert.equal(downloads, 1);
  assert.equal((await run(first().cache)).stdout.trim(), 'present');
  await run(first('blocked').install);
  assert.equal(downloads, 1);
  const second = release('1.1.0-beta.2');
  await run(second().install);
  assert.equal(downloads, 2);
  await run(first().install);
  assert.equal(downloads, 2);
  const marker = path.join(
    home,
    '.alune-ssh/runtime/versions/1.1.0-beta.2',
    target,
    '.install-complete',
  );
  fs.writeFileSync(marker, 'corrupt');
  const good = archive;
  archive = Buffer.from('broken');
  await assert.rejects(run(second().install), /checksum mismatch/);
  archive = good;
  await assert.rejects(run(second().install, false), /cancelled/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'corrupt');
  await run(second().install);
  assert.equal(JSON.parse(fs.readFileSync(marker)).target, target);
  // Keep the valid marker and break only the launcher.
  const executable = path.join(
    path.dirname(marker),
    'bin',
    win ? 'alune-agent.cmd' : 'alune-agent',
  );
  fs.writeFileSync(executable, win ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n');
  assert.equal((await run(second().cache)).stdout.trim(), '');
  await run(second().install);
  assert.equal((await run(second().cache)).stdout.trim(), 'present');
  console.log(target + ' concurrent install, proxy denial, offline rollback and repair passed.');
} finally {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
}
