// Verify real stdio negotiation without requiring the installed SDK to impersonate an older one.
import assert from 'node:assert/strict';
import contract from './protocol-1-capabilities.json' with { type: 'json' };
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
const [bundle, receipt] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
const node = path.resolve(bundle, manifest.node.executable);
const entry = path.resolve(bundle, 'node_modules/@alune/agent/bin/alune-agent.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-protocol-matrix-'));
const members = new Map();
async function probe(major, minor, later = []) {
  const child = spawn(node, [entry, 'serve', '--data-dir', root], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let detail = '';
  child.stderr.on('data', (b) => {
    detail = (detail + b.toString()).slice(-2048);
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  let id = 0;
  async function call(method, params = {}) {
    const key = 'compat:' + ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
    for (;;) {
      const item = await lines.next();
      if (item.done) throw Error('Missing ' + method + ' reply: ' + detail);
      const m = JSON.parse(item.value);
      if (m.id === key) return m;
    }
  }
  try {
    const init = await call('initialize', {
      protocol: { major, minor },
      client: { name: 'packaged-compat', version: 'test' },
    });
    if (major !== 1) {
      assert.equal(init.error?.code, -32001);
      assert.equal((await call('agent.health')).error?.code, -32000);
      return;
    }
    const negotiated = Math.min(minor, 6);
    assert.deepEqual(init.result.protocol, { major: 1, minor: negotiated });
    const caps = [...init.result.capabilities].sort();
    assert.deepEqual([...(await call('agent.capabilities')).result.capabilities].sort(), caps);
    assert.equal((await call('agent.health')).result.agentId, init.result.agentId);
    assert.deepEqual((await call('agent.version')).result.protocol, { major: 1, minor: 6 });
    assert.deepEqual(
      caps,
      contract
        .slice(0, negotiated + 1)
        .flat()
        .sort(),
      'public methods for negotiated protocol 1.' + negotiated,
    );
    // Send a deliberately invalid parameter object to each method introduced
    // later: an older client must receive unknown-method before validation or side effects.
    for (const name of later.filter((x) => !caps.includes(x)))
      assert.equal((await call(name, { compatibilityProbe: true })).error?.code, -32601, name);
    if (members.has(negotiated)) assert.deepEqual(caps, members.get(negotiated));
    members.set(negotiated, caps);
  } finally {
    child.stdin.end();
    try {
      assert.deepEqual(await done, { code: 0, signal: null }, detail);
    } finally {
      clearTimeout(timer);
    }
  }
}
try {
  await probe(1, 6);
  const latest = members.get(6);
  for (let minor = 0; minor < 6; minor++) await probe(1, minor, latest);
  await probe(1, 99);
  await probe(2, 0);
  const levels = Array.from({ length: 7 }, (_, i) => {
    const a = members.get(i),
      prev = members.get(i - 1) ?? [];
    assert.ok(prev.every((n) => a.includes(n)));
    return {
      minor: i,
      added: a.filter((n) => !prev.includes(n)),
      total: a.length,
      unknownMethodsChecked: latest.length - a.length,
    };
  });
  const proof = {
    source: manifest.sourceSha,
    target: manifest.target,
    protocol: '1.6',
    mode: 'local stdio',
    futureMinorNegotiates: 6,
    incompatibleMajorRejected: true,
    levels,
  };
  if (receipt) fs.writeFileSync(receipt, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
