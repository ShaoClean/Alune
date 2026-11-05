// Disposable real Web + Agent repository read/write fixture for browser acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const { spawnAgent } = require('../../packages/agent-client/dist/node');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p3-browser-'));
const repo = path.join(temp, 'P3 Read Fixture');
fs.mkdirSync(repo);
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: path.join(temp, 'empty-config'),
  GIT_CONFIG_NOSYSTEM: '1',
};
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, stdio: 'pipe' });
git('init', '-b', 'main');
git('config', 'user.name', 'P3 Fixture');
git('config', 'user.email', 'fixture@example.test');
const lines = Array.from(
  { length: 80 },
  (_, i) => `export const line${i + 1} = "unchanged ${i + 1}";`,
);
fs.writeFileSync(path.join(repo, 'demo.ts'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(repo, 'README.md'), '# P3 文件预览\n\n**Markdown**、中文和内容查找。\n');
fs.writeFileSync(
  path.join(repo, 'pixel.png'),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP0cAAAAASUVORK5CYII=',
    'base64',
  ),
);
git('add', '.');
git('commit', '-m', 'initial fixture');
lines[39] = 'export const line40 = "Agent changed line";';
fs.writeFileSync(path.join(repo, 'demo.ts'), lines.join('\n') + '\n');
process.env.ALUNE_DATA_DIR = path.join(temp, 'legacy');
const { startServer } = require('../../apps/server/dist/bootstrap');
const { RepositoryService } = require('../../apps/server/dist/repository/repository.service');
const app = await startServer({ port: 0, host: '127.0.0.1' });
const legacy = await app.get(RepositoryService).addLocal(repo);
const entry = path.join(root, 'packages/agent/bin/alune-agent.cjs'),
  data = path.join(temp, 'agent');
const initial = spawnAgent(process.execPath, [entry, 'serve', '--data-dir', data], { env });
await initial.client.initialize();
const registered = await initial.client.registerRepository(repo);
await initial.close();
const token = randomUUID();
const children = new Set();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 8 * 1024 * 1024 });
await new Promise((resolve) => wss.once('listening', resolve));
wss.on('connection', (socket, request) => {
  if (new URL(request.url, 'http://localhost').searchParams.get('token') !== token) {
    socket.close();
    return;
  }
  const child = spawn(process.execPath, [entry, 'serve', '--data-dir', data], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (socket.readyState === 1) socket.send(line);
  });
  socket.on('message', (bytes) => child.stdin.write(bytes.toString() + '\n'));
  socket.on('close', () => child.stdin.end());
  child.on('close', () => {
    children.delete(child);
    lines.close();
    socket.close();
  });
  child.stdin.on('error', () => socket.close());
  child.stderr.resume();
});
const { createServer } = await import('vite');
const fixture = {
  legacyId: legacy.id,
  resource: registered.resource,
  socket: `ws://127.0.0.1:${wss.address().port}/?token=${token}`,
};
const backend = await app.getUrl();
const vite = await createServer({
  root: path.join(root, 'apps/web'),
  configFile: path.join(root, 'apps/web/vite.config.ts'),
  plugins: [
    {
      name: 'p3-fixture',
      configureServer(server) {
        server.middlewares.use('/p3-fixture.json', (_req, res) => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(fixture));
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 0,
    proxy: {
      '/api': { target: backend, rewrite: (p) => p.replace(/^\/api/, '') },
      '/socket.io': { target: backend, ws: true },
    },
  },
});
await vite.listen();
console.log(
  JSON.stringify({
    url: `http://127.0.0.1:${vite.httpServer.address().port}`,
    legacyId: legacy.id,
    resource: registered.resource,
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const socket of wss.clients) socket.close();
  for (const child of children) child.stdin.end();
  await Promise.all(
    [...children].map((child) => new Promise((resolve) => child.once('close', resolve))),
  );
  wss.close();
  await vite.close();
  await app.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
