import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Isolated browser acceptance: mutations affect memory only, never SSH or user data.
const root = path.resolve(process.argv[2] || fileURLToPath(new URL('../dist/', import.meta.url)));
const originalConnections = [
  {
    id: 'dev',
    name: '开发服务器',
    host: 'dev.example.invalid',
    authType: 'sshAgent',
    status: 'connected',
  },
  {
    id: 'staging',
    name: '预发布服务器',
    host: 'staging.example.invalid',
    authType: 'privateKey',
    status: 'connected',
  },
  {
    id: 'build',
    name: '构建服务器',
    host: 'build.example.invalid',
    authType: 'privateKey',
    status: 'error',
    error: '连接超时，请检查主机地址后重试。',
  },
  {
    id: 'archive',
    name: '归档服务器',
    host: 'archive.example.invalid',
    authType: 'password',
    status: 'unknown',
  },
].map((item) => ({ username: 'developer', port: 22, ...item }));
const originalRepositories = [
  'alune',
  'design-system',
  'api-gateway',
  'docs',
  'infra',
  'release-tools',
].map((name, i) => ({
  id: `repo-${i + 1}`,
  name,
  path: `/workspace/${name}`,
  connectionId: i < 3 ? 'dev' : i < 5 ? 'staging' : 'build',
}));
let connections;
let repositories;
let config;
const actions = [];
function reset() {
  connections = structuredClone(originalConnections);
  repositories = structuredClone(originalRepositories);
  config = { delay: 0, listError: false, empty: false, long: false };
  actions.length = 0;
}
reset();
const json = (response, value, status = 200) =>
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  if (pathname === '/__fixture/actions') return json(response, actions);
  if (pathname === '/__fixture/reset') {
    reset();
    return json(response, { ok: true });
  }
  if (pathname === '/__fixture/config' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += chunk;
    config = { ...config, ...JSON.parse(body) };
    return json(response, config);
  }
  if (pathname.startsWith('/socket.io/'))
    return json(response, { message: 'Fixture has no socket transport' }, 404);
  if (pathname.startsWith('/api/')) {
    actions.push({ method: request.method, path: pathname });
    if (config.delay) await new Promise((resolve) => setTimeout(resolve, config.delay));
    if (pathname === '/api/ai/settings')
      return json(response, {
        revision: 'fixture',
        providers: [],
        commit: {},
        secretStorage: { available: false },
      });
    if (pathname === '/api/connections')
      return json(
        response,
        config.empty
          ? []
          : connections.map((connection) => ({
              ...connection,
              ...(config.long
                ? {
                    name: connection.name.repeat(8),
                    host: `${'long-host-name.'.repeat(8)}example.invalid`,
                  }
                : {}),
            })),
      );
    if (pathname === '/api/repositories') {
      if (config.listError) return json(response, { message: '模拟仓库列表读取失败' }, 503);
      return json(
        response,
        config.empty
          ? []
          : repositories.map((repo) => ({
              ...repo,
              ...(config.long
                ? {
                    name: repo.name.repeat(10),
                    path: `/workspace/${'long-directory/'.repeat(12)}${repo.name}`,
                  }
                : {}),
            })),
      );
    }
    const [, , kind, id, operation] = pathname.split('/');
    if (kind === 'connections') {
      if (request.method === 'DELETE') {
        connections = connections.filter((item) => item.id !== id);
        return json(response, { success: true });
      }
      if (operation === 'test') {
        const success = id !== 'build';
        return json(response, {
          success,
          status: success ? 'connected' : 'error',
          error: success ? undefined : '连接超时，请检查主机地址后重试。',
          updatedAt: Date.now(),
        });
      }
    }
    const repo = repositories.find((item) => item.id === id);
    if (!repo) return json(response, { message: 'Fixture item not found' }, 404);
    if (request.method === 'DELETE') {
      repositories = repositories.filter((item) => item.id !== id);
      return json(response, { success: true });
    }
    if (!operation) return json(response, repo);
    if (operation === 'status') {
      if (id === 'repo-6') return json(response, { message: 'SSH 连接超时' }, 503);
      return json(response, {
        branch: config.long
          ? `feature/${'long-branch-'.repeat(14)}`
          : id === 'repo-2'
            ? 'feat/navigation'
            : id === 'repo-5'
              ? ''
              : 'main',
        files:
          id === 'repo-1'
            ? [
                {
                  path: 'src/App.tsx',
                  status: 'modified',
                  staged: false,
                  additions: 4,
                  deletions: 2,
                },
              ]
            : [],
        ahead: id === 'repo-1' ? 2 : 0,
        behind: id === 'repo-2' ? 1 : 0,
      });
    }
    if (operation === 'log')
      return json(response, {
        commits: [],
        hasMore: false,
        nextSkip: 0,
        revision: 'fixture',
        shallow: false,
      });
    return json(response, []);
  }
  const file = path.resolve(
    root,
    pathname.startsWith('/assets/') || pathname === '/favicon.png' ? `.${pathname}` : 'index.html',
  );
  if (path.relative(root, file).startsWith('..')) return json(response, {}, 403);
  try {
    const bytes = await readFile(file);
    const type =
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () =>
  console.log(`Collection views fixture: http://127.0.0.1:${server.address().port}`),
);
