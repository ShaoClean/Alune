// Manual/browser QA fixture: real isolated Git and the production local API,
// with an in-process SSH stand-in and mock model endpoints. No external AI calls.
// Run after building shared, ssh-client, server and web: node apps/server/test/ai-ui-fixture.cjs
const { createServer } = require('node:http');
const { join } = require('node:path');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startServer } = require('../dist/bootstrap');
const { ConnectionService } = require('../dist/connection/connection.service');
const { RepositoryService } = require('../dist/repository/repository.service');

async function main() {
  const fixture = createRepository();
  process.env.REMOTE_GIT_DATA_DIR = join(fixture.root, 'app-data');
  fixture.write('src/commit.ts', 'export const stagedOnly = true;\n');
  fixture.git('add', 'src/commit.ts');
  fixture.write('src/commit.ts', 'export const unstagedOnly = true;\n');
  fixture.write('README-new.md', 'Untracked documentation\n');
  const repos = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      connectionId: '33333333-3333-4333-8333-333333333333',
      name: 'remote-git · AI 验证',
      path: fixture.repo,
      pinned: true,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      connectionId: '33333333-3333-4333-8333-333333333333',
      name: '第二个仓库 · 草稿隔离',
      path: fixture.repo,
      pinned: false,
    },
  ];
  let mode = 'success';
  let calls = 0;
  let aborted = 0;
  let lastBody;
  let expectedApiKey;
  let authenticated;
  const mock = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/control') {
      if (body.mode) mode = body.mode;
      if (typeof body.expectedApiKey === 'string')
        expectedApiKey = body.expectedApiKey;
      if (body.restage) {
        fixture.write(
          'src/commit.ts',
          `export const changedIndex = ${Date.now()};\n`,
        );
        fixture.git('add', 'src/commit.ts');
      }
      res.end(
        JSON.stringify({ mode, calls, aborted, lastBody, authenticated }),
      );
      return;
    }
    calls++;
    lastBody = body;
    const apiKey =
      req.headers['x-api-key'] ??
      req.headers['x-goog-api-key'] ??
      req.headers.authorization?.replace(/^Bearer /, '') ??
      '';
    const requestAuthenticated =
      expectedApiKey === undefined ? undefined : apiKey === expectedApiKey;
    authenticated = requestAuthenticated;
    const complete = () => {
      if (mode === 'auth' || requestAuthenticated === false) {
        res.writeHead(401);
        res.end('{"error":"test authentication failure"}');
        return;
      }
      if (req.method === 'GET') {
        if (mode === 'no-models') {
          res.writeHead(404);
          res.end('{}');
          return;
        }
        res.end(
          JSON.stringify({
            data: [
              { id: 'fixture-model', display_name: '演示模型' },
              { id: 'second-model' },
            ],
            models: [{ name: 'models/fixture-model', displayName: '演示模型' }],
          }),
        );
        return;
      }
      const text =
        mode === 'empty'
          ? ''
          : JSON.stringify({
              message: 'feat(git): 支持 AI 生成提交信息',
              description:
                '根据已暂存改动生成摘要与描述\n\n保留 "引号"、$(literal) 与 `反引号`，由用户确认后提交。',
            });
      const payload = req.url.endsWith('/messages')
        ? { content: [{ type: 'text', text }] }
        : req.url.includes(':generateContent')
          ? { candidates: [{ content: { parts: [{ text }] } }] }
          : { choices: [{ message: { content: text } }] };
      res.end(JSON.stringify(payload));
    };
    const timer = setTimeout(complete, mode === 'slow' ? 5000 : 250);
    res.on('close', () => {
      if (!res.writableEnded) aborted++;
      clearTimeout(timer);
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    webRoot: join(__dirname, '../../web/dist'),
  });
  const connections = app.get(ConnectionService);
  connections.ensureConnected = async () => fixture.connection;
  connections.list = async () => [
    {
      id: repos[0].connectionId,
      name: '本地隔离测试',
      host: 'fixture.invalid',
      port: 22,
      username: 'test',
      authType: 'password',
    },
  ];
  const repositories = app.get(RepositoryService);
  repositories.get = async (id) =>
    repos.find((repo) => repo.id === id) || repos[0];
  repositories.list = async () => repos;
  const address = {
    origin: await app.getUrl(),
    modelUrl: `http://127.0.0.1:${mock.address().port}/v1`,
    controlUrl: `http://127.0.0.1:${mock.address().port}/control`,
    repositoryUrl: `${await app.getUrl()}/repositories/${repos[0].id}`,
    root: fixture.root,
  };
  console.log(JSON.stringify(address));
  if (process.env.REMOTE_GIT_AI_FIXTURE_INFO)
    require('node:fs').writeFileSync(
      process.env.REMOTE_GIT_AI_FIXTURE_INFO,
      JSON.stringify(address),
    );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    mock.closeAllConnections();
    mock.close();
    await app.close();
    fixture.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
