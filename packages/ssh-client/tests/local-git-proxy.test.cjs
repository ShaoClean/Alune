const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { LocalConnection } = require('../dist');
const { listen, httpProxy, forwardingSSH } = require('./helpers/proxy-fixture.cjs');

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-local-proxy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo ' $literal");
  fs.mkdirSync(repo);
  const environment = {
    GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    NO_PROXY: '*',
    no_proxy: '*',
  };
  fs.writeFileSync(environment.GIT_CONFIG_GLOBAL, '');
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      env: { ...process.env, ...environment },
      encoding: 'utf8',
    });
  git('init', '-q', '-b', 'main');
  git('config', 'http.proxy', 'http://unreachable.invalid:1');
  git('config', 'http.http://git.fixture.test.proxy', '');
  git('config', 'remote.origin.proxy', '');
  return { root, repo, git, environment };
}

const snapshot = (port) => ({
  revision: 'local-test',
  enabled: true,
  protocol: 'http',
  host: '127.0.0.1',
  port,
  credentials: { username: 'fixture-local', password: 'fixture-local-password' },
});
const advertisement = '001e# service=git-upload-pack\n00000000';

test('local HTTP Git overrides scoped proxy and NO_PROXY without persisting credentials or config', async (t) => {
  const f = repository(t);
  const received = [];
  const origin = await listen(
    http.createServer((req, res) => {
      received.push(req.headers);
      res.setHeader('Content-Type', 'application/x-git-upload-pack-advertisement');
      res.end(advertisement);
    }),
  );
  t.after(origin.close);
  const proxy = await httpProxy({ credentials: snapshot(0).credentials });
  t.after(proxy.close);
  const local = new LocalConnection(undefined, () => snapshot(proxy.port));
  const before = f.git('config', '--local', '--list');
  const result = await local.execGit(
    f.repo,
    ['ls-remote', `http://git.fixture.test:${origin.port}/repo.git`],
    undefined,
    { environment: f.environment },
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(proxy.records.some((entry) => entry.host === 'git.fixture.test'));
  assert.ok(received.length > 0);
  assert.ok(received.every((headers) => !headers['proxy-authorization']));
  assert.equal(f.git('config', '--local', '--list'), before);
  assert.ok(!JSON.stringify(result).includes(snapshot(0).credentials.password));
});

test('unreadable proxy settings fail network operations but leave offline Git usable', async (t) => {
  const f = repository(t);
  const local = new LocalConnection(undefined, () => {
    throw new Error('proxy settings unavailable');
  });
  await assert.rejects(local.execGit(f.repo, ['fetch', 'origin']), /proxy settings unavailable/);
  const result = await local.execGit(f.repo, ['status', '--porcelain'], undefined, {
    environment: f.environment,
  });
  assert.equal(result.exitCode, 0, result.stderr);
});

test('repository protocol overrides cannot bypass the enabled app proxy', async (t) => {
  const f = repository(t);
  let directConnections = 0;
  const origin = await listen(
    net.createServer((socket) => {
      directConnections++;
      socket.end();
    }),
  );
  t.after(origin.close);
  f.git('config', 'protocol.git.allow', 'always');
  const local = new LocalConnection(undefined, () => snapshot(1));
  const result = await local.execGit(
    f.repo,
    ['ls-remote', `git://127.0.0.1:${origin.port}/repo.git`],
    undefined,
    {
      environment: { ...f.environment, GIT_ALLOW_PROTOCOL: 'git' },
    },
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /transport 'git' not allowed/);
  assert.equal(directConnections, 0);
});

test('cancelling a local Git transfer closes its proxy tunnel', { timeout: 15_000 }, async (t) => {
  const f = repository(t);
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let closed;
  const disconnected = new Promise((resolve) => {
    closed = resolve;
  });
  const origin = await listen(
    http.createServer((req) => {
      req.socket.once('close', closed);
      started(); // Keep the Git advertisement pending until the operation is cancelled.
    }),
  );
  t.after(origin.close);
  const proxy = await httpProxy({ credentials: snapshot(0).credentials });
  t.after(proxy.close);
  const controller = new AbortController();
  const local = new LocalConnection(controller.signal, () => snapshot(proxy.port));
  const operation = local.execGit(
    f.repo,
    ['ls-remote', `http://git.fixture.test:${origin.port}/repo.git`],
    undefined,
    { environment: f.environment },
  );
  const rejected = assert.rejects(operation, /cancel local proxy/);
  await ready;
  controller.abort(new Error('cancel local proxy'));
  await rejected;
  await disconnected;
  assert.ok(proxy.records.length > 0);
});

test(
  'local SSH Git uses the application runtime for proxy tunnelling',
  { skip: process.platform === 'win32', timeout: 15_000 },
  async (t) => {
    const f = repository(t);
    f.git('config', 'user.name', 'Fixture');
    f.git('config', 'user.email', 'fixture@example.invalid');
    f.git('config', 'commit.gpgSign', 'false');
    f.git('commit', '--allow-empty', '-qm', 'fixture');
    const ssh = await forwardingSSH({ environment: { ...process.env, ...f.environment } });
    t.after(ssh.close);
    const knownHosts = path.join(f.root, 'known_hosts');
    fs.writeFileSync(knownHosts, `[git.fixture.test]:${ssh.port} ssh-rsa ${ssh.publicKey}\n`);
    const bin = path.join(f.root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'ssh'),
      `#!/bin/sh\nexec /usr/bin/ssh -o UserKnownHostsFile='${knownHosts}' "$@"\n`,
      { mode: 0o700 },
    );
    const proxy = await httpProxy({ credentials: snapshot(0).credentials });
    t.after(proxy.close);
    const local = new LocalConnection(undefined, () => snapshot(proxy.port));
    const result = await local.execGit(
      f.repo,
      ['ls-remote', `ssh://fixture@git.fixture.test:${ssh.port}${f.repo}`],
      undefined,
      {
        environment: { ...f.environment, PATH: `${bin}:${process.env.PATH}` },
      },
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes(f.git('rev-parse', 'HEAD').trim()));
    assert.ok(proxy.records.some((entry) => entry.host === 'git.fixture.test'));
  },
);
