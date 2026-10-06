const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const { LocalConnection } = require('../dist');
const { listen, httpProxy } = require('./helpers/proxy-fixture.cjs');

const snapshot = (port) => ({
  revision: 'partial-clone-test', enabled: true, protocol: 'http', host: '127.0.0.1', port,
});

async function partialRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-partial-proxy-'));
  const environment = {
    GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    NO_PROXY: '*', no_proxy: '*',
  };
  fs.writeFileSync(environment.GIT_CONFIG_GLOBAL, '');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
    env: { ...process.env, ...environment }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const seed = path.join(root, 'seed');
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'partial');
  fs.mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'config', 'user.name', 'Fixture');
  git(seed, 'config', 'user.email', 'fixture@example.invalid');
  git(seed, 'config', 'commit.gpgSign', 'false');
  const payload = 'blob fetched lazily through the app proxy\n';
  fs.writeFileSync(path.join(seed, 'file.txt'), payload);
  git(seed, 'add', '.');
  git(seed, 'commit', '-qm', 'partial clone fixture');
  const blob = git(seed, 'rev-parse', 'HEAD:file.txt').trim();
  git(root, 'clone', '--bare', seed, remote);
  git(remote, 'config', 'uploadpack.allowFilter', 'true');
  // file:// still uses upload-pack and honors filtering, unlike a local-path clone.
  git(root, 'clone', '--filter=blob:none', '--no-checkout', pathToFileURL(remote).href, repo);
  assert.equal(git(repo, 'config', '--bool', 'remote.origin.promisor').trim(), 'true');
  assert.ok(git(repo, 'rev-list', '--objects', '--all', '--missing=print').includes(`?${blob}`),
    'the test must begin with a genuinely missing promised blob');

  const requests = [];
  const children = new Set();
  const origin = await listen(http.createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    const url = new URL(request.url, 'http://127.0.0.1');
    const child = spawn('git', ['http-backend'], {
      env: {
        ...process.env, ...environment,
        GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers['content-type'] || '',
        HTTP_GIT_PROTOCOL: request.headers['git-protocol'] || '',
      },
    });
    children.add(child);
    let buffered = Buffer.alloc(0), headersSent = false;
    child.stdout.on('data', (chunk) => {
      if (headersSent) return response.write(chunk);
      buffered = Buffer.concat([buffered, chunk]);
      const boundary = buffered.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      const headers = {};
      let status = 200;
      for (const line of buffered.subarray(0, boundary).toString().split('\r\n')) {
        const colon = line.indexOf(':');
        const key = line.slice(0, colon), value = line.slice(colon + 1).trim();
        if (key.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
        else headers[key] = value;
      }
      headersSent = true;
      response.writeHead(status, headers);
      response.write(buffered.subarray(boundary + 4));
    });
    child.once('error', () => response.destroy());
    child.once('close', () => { children.delete(child); response.end(); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    request.pipe(child.stdin);
    response.once('close', () => child.kill());
  }));
  t.after(async () => {
    origin.close();
    await Promise.all([...children].map((child) => new Promise((resolve) => {
      child.once('close', resolve);
      child.kill();
    })));
    fs.rmSync(root, { recursive: true, force: true });
  });
  // A reachable address makes an accidental direct connection observable.
  git(repo, 'remote', 'set-url', 'origin', `http://127.0.0.1:${origin.port}/remote.git`);
  return { repo, seed, environment, git, blob, payload, requests, origin };
}

test('partial-clone show routes its real lazy fetch through the app proxy', { timeout: 15_000 }, async (t) => {
  const f = await partialRepository(t);
  const proxy = await httpProxy();
  t.after(proxy.close);
  const local = new LocalConnection(undefined, () => snapshot(proxy.port));
  const result = await local.execGit(f.repo, ['show', 'HEAD:file.txt'], undefined, { environment: f.environment });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, f.payload);
  assert.ok(proxy.records.some((entry) => entry.port === f.origin.port),
    'the implicit promisor fetch must use the app proxy');
  assert.ok(f.requests.some((entry) => entry.headers['git-protocol'] === 'version=2'),
    'the real HTTP backend must receive Git protocol negotiation');
  assert.ok(f.requests.some((entry) => entry.url.endsWith('/git-upload-pack')));
  assert.ok(!f.git(f.repo, 'rev-list', '--objects', '--all', '--missing=print').includes(`?${f.blob}`),
    'the promised blob must actually arrive in the object database');
});

test('partial-clone lazy fetch never falls back to a directly reachable origin', { timeout: 15_000 }, async (t) => {
  const f = await partialRepository(t);
  const proxy = await httpProxy({ status: 407 });
  t.after(proxy.close);
  const local = new LocalConnection(undefined, () => snapshot(proxy.port));
  const result = await local.execGit(f.repo, ['show', 'HEAD:file.txt'], undefined, { environment: f.environment });
  assert.notEqual(result.exitCode, 0);
  assert.ok(proxy.records.length > 0, 'the lazy fetch must attempt the configured proxy');
  assert.equal(f.requests.length, 0, 'a rejected proxy must not leak a direct HTTP request');
  assert.ok(f.git(f.repo, 'rev-list', '--objects', '--all', '--missing=print').includes(`?${f.blob}`));
});

test('ordinary repositories retain offline Git when app proxy settings cannot be read', async (t) => {
  const f = await partialRepository(t);
  const local = new LocalConnection(undefined, () => { throw new Error('unreadable app proxy'); });
  const result = await local.execGit(f.seed, ['show', 'HEAD:file.txt'], undefined, { environment: f.environment });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, f.payload);
  assert.equal(f.requests.length, 0);
});
