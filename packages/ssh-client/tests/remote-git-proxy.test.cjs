const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { sshProxyCommand, isLoopbackAddress } = require('../dist/proxy-git');
const { createProxyBridge } = require('../dist');
const { listen, httpProxy } = require('./helpers/proxy-fixture.cjs');

const which = (name) => {
  try {
    return execFileSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
};

// Run the ProxyCommand as ssh would, with PATH limited to the chosen tool.
function runProxyCommand(t, port, tools, host, targetPort, input) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-proxy-tools-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  for (const name of ['sh', 'grep', ...tools]) fs.symlinkSync(which(name), path.join(bin, name));
  const command = sshProxyCommand(port).replace('%h', host).replace('%p', String(targetPort));
  const child = spawn('/bin/sh', ['-c', `exec ${command}`], { env: { PATH: bin } });
  const stdout = [], stderr = [];
  child.stdout.on('data', (data) => stdout.push(data));
  child.stderr.on('data', (data) => stderr.push(data));
  child.stdin.write(input);
  return new Promise((resolve) => {
    child.stdout.once('data', () => child.stdin.end());
    child.once('close', (code) => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
    setTimeout(() => child.kill(), 5_000).unref();
  });
}

const tools = [
  ['nc', () => /-X/.test(spawnText('nc', ['-h']))],
  ['ncat', () => true],
  ['connect', () => true],
  ['socat', () => true],
  ['python3', () => true],
];
function spawnText(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
}

for (const [tool, supported] of tools) {
  test(`SSH ProxyCommand tunnels through ${tool}`, { skip: process.platform === 'win32' || !which(tool) || !supported() ? `${tool} unavailable` : false }, async (t) => {
    const origin = await listen(net.createServer((socket) => socket.pipe(socket))); t.after(origin.close);
    const proxy = await httpProxy(); t.after(proxy.close);
    // The remote end of the SSH forward reaches Alune's local bridge, not the proxy itself.
    const bridge = await createProxyBridge(() => ({ revision: 'tool-test', enabled: true, protocol: 'http', host: '127.0.0.1', port: proxy.port })); t.after(() => bridge.close());
    const result = await runProxyCommand(t, bridge.port, [tool], 'git.fixture.test', origin.port, 'SSH-2.0-alune\r\n');
    assert.equal(result.stdout, 'SSH-2.0-alune\r\n', result.stderr);
    assert.deepEqual(proxy.records.map(({ host, port }) => ({ host, port })), [{ host: 'git.fixture.test', port: origin.port }]);
  });
}

test('SSH ProxyCommand explains which tools are missing', { skip: process.platform === 'win32' }, async (t) => {
  const result = await runProxyCommand(t, 9, [], 'git.fixture.test', 22, '');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /nc、ncat、connect、socat 或 python3/);
});

test('ProxyCommand avoids characters that ssh or fish would rewrite', () => {
  const command = sshProxyCommand(43123);
  assert.ok(!command.replace(/%[hp]/g, '').includes('%'));
  assert.ok(!command.includes('\\'));
});

test('loopback originators are recognised', () => {
  for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(address), true, address);
  for (const address of ['0.0.0.0', '10.0.0.1', '203.0.113.5', '::', 'fe80::1', '127.0.0.1.example', '']) assert.equal(isLoopbackAddress(address), false, address);
});
