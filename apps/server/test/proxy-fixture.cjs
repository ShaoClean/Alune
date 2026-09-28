const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { listen, httpProxy, socksProxy, forwardingSSH, tlsOptions, certificate } = require('../../../packages/ssh-client/tests/helpers/proxy-fixture.cjs');
const { startServer } = require('../dist/bootstrap');
const { ConnectionService } = require('../dist/connection/connection.service');
const { RepositoryService } = require('../dist/repository/repository.service');
const { ProxyService } = require('../dist/proxy/proxy.service');

async function startProxyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-proxy-e2e-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.platform() === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const seed = path.join(root, 'seed'), repo = path.join(root, 'workspace'), worktree = path.join(root, 'worktree');
  fs.mkdirSync(seed); git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'config', 'user.name', 'Proxy Fixture'); git(seed, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(seed, 'README.md'), 'proxy fixture\n'); git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'initial');
  git(root, 'clone', '--bare', seed, 'remote.git'); git(root, 'clone', path.join(root, 'remote.git'), repo);
  git(repo, 'config', 'user.name', 'Proxy Fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid');
  git(repo, 'config', 'http.sslCAInfo', certificate); git(repo, 'config', 'http.proxy', 'http://unreachable.invalid:1');
  git(repo, 'config', 'remote.origin.proxy', ''); // Must not silently bypass the application proxy.
  git(repo, 'worktree', 'add', '-qb', 'side', worktree);
  git(path.join(root, 'remote.git'), 'config', 'http.receivepack', 'true');

  const payload = Buffer.from('controlled-update-payload');
  const dmg = 'Alune-0.5.0-mac-arm64.dmg', sha = createHash('sha256').update(payload).digest('hex');
  const urls = [], aiRequests = [];
  const releases = await listen(https.createServer(tlsOptions, (request, response) => {
    urls.push({ host: request.headers.host, path: request.url });
    const base = 'https://github.com/ShaoClean/Alune/releases/download/v0.5.0/';
    if (request.url.endsWith('/releases/latest')) return response.end(JSON.stringify({ tag_name: 'v0.5.0', body: 'fixture', assets: [
      { name: dmg, size: payload.length, browser_download_url: base + dmg }, { name: 'SHA256SUMS', browser_download_url: base + 'SHA256SUMS' },
    ] }));
    if (request.url.endsWith('SHA256SUMS')) return response.end(`${sha}  ${dmg}\n`);
    if (request.url.endsWith('.dmg')) { response.writeHead(302, { location: 'https://release-assets.githubusercontent.com/payload' }); return response.end(); }
    response.end(payload);
  }));
  const ai = await listen(http.createServer((request, response) => {
    aiRequests.push({ path: request.url, headers: request.headers });
    request.resume(); response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url.endsWith('/models') ? { data: [{ id: 'fixture-model' }] } : { choices: [{ message: { content: JSON.stringify({ message: 'feat: proxy fixture', description: '' }) } }] }));
  }));
  const gitHTTP = await listen(https.createServer(tlsOptions, (request, response) => {
    const url = new URL(request.url, 'https://git.fixture.test');
    const child = spawn('git', ['http-backend'], { env: { ...env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: request.method, CONTENT_TYPE: request.headers['content-type'] || '', REMOTE_USER: 'fixture' } });
    let buffered = Buffer.alloc(0), headersSent = false;
    child.stdout.on('data', (chunk) => {
      if (headersSent) return response.write(chunk);
      buffered = Buffer.concat([buffered, chunk]); const boundary = buffered.indexOf('\r\n\r\n'); if (boundary < 0) return;
      const headers = {}; let status = 200;
      for (const line of buffered.subarray(0, boundary).toString().split('\r\n')) {
        const colon = line.indexOf(':'); const key = line.slice(0, colon), value = line.slice(colon + 1).trim();
        if (key.toLowerCase() === 'status') status = Number(value.split(' ')[0]); else headers[key] = value;
      }
      headersSent = true; response.writeHead(status, headers); response.write(buffered.subarray(boundary + 4));
    });
    child.on('close', () => response.end()); child.stderr.resume(); child.stdin.on('error', () => {}); request.pipe(child.stdin);
    response.on('close', () => child.kill());
  }));
  const bin = path.join(root, 'bin'), knownHosts = path.join(root, 'known_hosts'); fs.mkdirSync(bin);
  const gitSSH = await forwardingSSH({ environment: env });
  fs.writeFileSync(knownHosts, `[git.fixture.test]:${gitSSH.port} ssh-rsa ${gitSSH.publicKey}\n`);
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nexec /usr/bin/ssh -o UserKnownHostsFile='${knownHosts}' "$@"\n`, { mode: 0o700 });
  const remote = await forwardingSSH({ environment: { ...env, PATH: `${bin}:${env.PATH}` } });
  const credentials = { username: 'fixture-user', password: 'fixture-password' };
  const map = (host, port) => ({ host: '127.0.0.1', port: ['api.github.com', 'github.com', 'release-assets.githubusercontent.com'].includes(host) ? releases.port : host === 'ai.fixture.test' ? ai.port : port });
  const proxies = {
    http: await httpProxy({ credentials, map }), socks5: await socksProxy({ credentials, map }), https: await httpProxy({ secure: true, credentials, map }),
  };
  const oldDir = process.env.ALUNE_DATA_DIR; process.env.ALUNE_DATA_DIR = path.join(root, 'app-data');
  const app = await startServer({ port: 0, webRoot: path.resolve(__dirname, '../../web/dist') });
  if (oldDir === undefined) delete process.env.ALUNE_DATA_DIR; else process.env.ALUNE_DATA_DIR = oldDir;
  const connections = app.get(ConnectionService), repositories = app.get(RepositoryService), proxy = app.get(ProxyService);
  const connection = await connections.create({ name: '代理验收服务器', host: '127.0.0.1', port: remote.port, username: 'fixture', authType: 'password', password: 'fixture' });
  // Register fixtures directly; opening one through the UI exercises normal SSH.
  const database = app.get('DATABASE');
  const repository = { id: '11111111-1111-4111-8111-111111111111', connectionId: connection.id, name: '代理测试仓库', path: repo, source: 'ssh' };
  const linked = { ...repository, id: '22222222-2222-4222-8222-222222222222', name: '关联 Worktree', path: worktree };
  for (const value of [repository, linked]) database.prepare('INSERT INTO repositories (id, connection_id, name, path) VALUES (?, ?, ?, ?)').run(value.id, value.connectionId, value.name, value.path);
  const httpsRemote = `https://git.fixture.test:${gitHTTP.port}/remote.git`, sshRemote = `ssh://fixture@git.fixture.test:${gitSSH.port}${root}/remote.git`;
  git(repo, 'remote', 'set-url', 'origin', httpsRemote);
  return { root, app, origin: await app.getUrl(), proxy, proxies, credentials, connection, connections, repositories, repository, linked, repo, worktree, seed, git, httpsRemote, sshRemote, ai, aiRequests, urls, remote, gitSSH,
    async close() {
      await app.close(); database.close(); for (const fixture of [releases, ai, gitHTTP, remote, gitSSH, ...Object.values(proxies)]) fixture.close();
      await new Promise((resolve) => setTimeout(resolve, 100)); fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
module.exports = { startProxyFixture };
if (require.main === module) startProxyFixture().then((fixture) => {
  console.log(JSON.stringify({ url: `${fixture.origin}/settings/proxy`, proxyHost: '127.0.0.1', proxyPort: fixture.proxies.http.port, credentials: fixture.credentials, httpTestUrl: `http://ai.fixture.test:${fixture.ai.port}/v1/models` }));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { if (!closing) { closing = true; void fixture.close().then(() => process.exit()); } });
}).catch((error) => { console.error(error); process.exit(1); });
