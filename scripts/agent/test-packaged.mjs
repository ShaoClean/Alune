import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { spawnAgent } from '../../packages/agent-client/dist/node.js';

const directory = path.resolve(process.argv[2] ?? '');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
if (process.argv.includes('--require-clean'))
  assert.equal(manifest.dirty, false, 'Package source was not a clean checkout');
assert.equal(manifest.target, `${process.platform}-${process.arch}`);
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256')
    .update(fs.readFileSync(path.join(directory, file)))
    .digest('hex');
  assert.equal(actual, expected, `Hash mismatch: ${file}`);
}
const node = path.join(directory, manifest.node.executable);
const entry = path.join(directory, 'node_modules/@alune/agent/bin/alune-agent.cjs');
const version = JSON.parse(execFileSync(node, [entry, 'version'], { encoding: 'utf8' }));
assert.equal(version.version, manifest.version);
const doctor = JSON.parse(
  execFileSync(node, [entry, 'doctor'], { encoding: 'utf8', timeout: 15000 }),
);
assert.equal(doctor.ok, true);
assert.deepEqual(doctor.native, { sqlite: true, pty: true });
assert.equal(doctor.node, `v${manifest.node.version}`);
// This check runs from the packaged entry, not from the checkout's module graph.
const require = createRequire(entry);
for (const name of ['electron', 'server', 'web'])
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
for (const [location, pkg] of Object.entries(manifest.packages)) {
  const base = path.join(directory, location);
  const metadata = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
  assert.equal(metadata.version, pkg.version);
  const localRequire = createRequire(path.join(base, 'package.json'));
  for (const dependency of Object.keys(metadata.dependencies ?? {})) {
    let resolved;
    try {
      resolved = localRequire.resolve(dependency);
    } catch {
      resolved = localRequire.resolve(dependency + '/package.json');
    }
    assert(
      fs.realpathSync(resolved).startsWith(fs.realpathSync(directory) + path.sep),
      `${dependency} escaped isolated bundle`,
    );
  }
}
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-packaged-session-'));
const children = [];
try {
  const a = spawnAgent(node, [entry, 'serve', '--data-dir', data]);
  children.push(a);
  const first = await a.client.initialize({ name: 'packaged-smoke', version: '1' });
  assert.equal((await a.client.health()).status, 'ok');
  assert((await a.client.capabilities()).capabilities.includes('events.subscribe'));
  await a.client.subscribe(['tasks.changed']);
  assert.deepEqual(await a.client.request('tasks.get', { requestId: 'missing' }), {
    scope: 'session',
    task: null,
  });
  await a.close();
  assert.equal((await a.exited).code, 0);
  const b = spawnAgent(node, [entry, 'serve', '--data-dir', data]);
  children.push(b);
  const second = await b.client.initialize();
  assert.equal(second.agentId, first.agentId);
  assert.notEqual(second.sessionId, first.sessionId);
  await b.close();
  assert.equal((await b.exited).code, 0);
} finally {
  await Promise.all(children.map((child) => child.close()));
  fs.rmSync(data, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    target: manifest.target,
    sourceSha: manifest.sourceSha,
    filesVerified: Object.keys(manifest.files).length,
    protocol:
      'initialize/health/version/capabilities/subscription/tasks/EOF/restart identity passed',
    native: doctor.native,
    node: doctor.node,
    electron: 'not resolvable',
  }),
);
