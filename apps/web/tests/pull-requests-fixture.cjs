// Real Nest endpoints + SQLite + SSH + Git. Only hosting HTTP responses are simulated.
const path = require('node:path');
const fs = require('node:fs');
const { createServer } = require('node:http');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');
const { startServer } = require('../../server/dist/bootstrap');
const { ConnectionService } = require('../../server/dist/connection/connection.service');
const { RepositoryService } = require('../../server/dist/repository/repository.service');

async function startPullRequestsFixture({ webRoot = path.resolve(__dirname, '../dist') } = {}) {
  const fixture = createRepository();
  const empty = createRepository();
  fixture.git('remote', 'add', 'origin', 'https://github.com/fixture/alune.git');
  fixture.git('remote', 'add', 'upstream', 'ssh://git@gitlab.example.com:2222/team/sub/alune.git');
  fixture.git('remote', 'add', 'unsupported', '/workspace/local.git');
  fixture.git('remote', 'add', 'gitlab', 'https://gitlab.com/team/alune.git');
  const servedRoot = path.join(fixture.root, 'web');
  fs.cpSync(webRoot, servedRoot, { recursive: true });
  const remote = await startSSHServer();
  const previousDir = process.env.ALUNE_DATA_DIR;
  process.env.ALUNE_DATA_DIR = path.join(fixture.root, 'app-data');
  const originalFetch = globalThis.fetch;
  const control = { status: 200, delay: 0, calls: [] };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (!['api.github.com', 'gitlab.example.com', 'gitlab.com'].includes(url.hostname))
      return originalFetch(input, options);
    const github = url.hostname === 'api.github.com';
    const token = options.headers[github ? 'Authorization' : 'PRIVATE-TOKEN'];
    const current = { status: control.status, delay: control.delay };
    control.calls.push({
      host: url.host,
      page: url.searchParams.get('page'),
      state: url.searchParams.get('state'),
      authenticated: Boolean(token),
    });
    if (current.delay)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, current.delay);
        options.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(options.signal.reason);
          },
          { once: true },
        );
      });
    if (current.status !== 200) return new Response('{}', { status: current.status });
    if (!github && !token) return new Response('{}', { status: 401 });
    const page = Number(url.searchParams.get('page'));
    const all = url.searchParams.get('state') === 'all';
    const items =
      page === 1
        ? [
            { number: 98, title: '支持获取仓库关联的 PR / MR', state: 'open', draft: false },
            { number: 94, title: '完善私有仓库的认证与访问提示', state: 'open', draft: true },
            ...(all
              ? [
                  { number: 89, title: '为工作区加入月光主题', state: 'merged', draft: false },
                  { number: 81, title: '更新提交历史的分支筛选', state: 'closed', draft: false },
                ]
              : []),
          ]
        : [{ number: 76, title: '分页加载更多协作记录', state: 'open', draft: false }];
    const data = items.map((item) =>
      github
        ? {
            ...item,
            state: item.state === 'merged' ? 'closed' : item.state,
            merged_at: item.state === 'merged' ? '2026-09-26T08:00:00Z' : null,
            user: { login: 'alune-contributor' },
            head: { label: `contributor:feature/${item.number}` },
            base: { ref: 'development' },
            updated_at: '2026-09-26T08:00:00Z',
          }
        : {
            ...item,
            iid: item.number,
            state: item.state === 'open' ? 'opened' : item.state,
            author: { username: 'alune-contributor' },
            source_branch: `feature/${item.number}`,
            target_branch: 'main',
            updated_at: '2026-09-26T08:00:00Z',
          },
    );
    return new Response(JSON.stringify(data), {
      headers: page === 1 ? { link: '<https://fixture.invalid/next>; rel="next"' } : {},
    });
  };
  const app = await startServer({ port: 0, webRoot: servedRoot });
  const connection = await app.get(ConnectionService).create({
    ...remote.options,
    name: 'PR/MR 验收服务器',
    authType: 'password',
  });
  const repositories = app.get(RepositoryService);
  const main = await repositories.add(connection.id, fixture.repo);
  const emptyRepo = await repositories.add(connection.id, empty.repo);
  const db = app.get('DATABASE');
  db.prepare('UPDATE repositories SET name = ? WHERE id = ?').run('alune', main.id);
  db.prepare('UPDATE repositories SET name = ? WHERE id = ?').run('empty-repo', emptyRepo.id);
  // Local fixture controls never exist in production.
  const controls = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text || '{}');
    if (Number.isInteger(body.status)) control.status = body.status;
    if (Number.isInteger(body.delay)) control.delay = body.delay;
    if (body.resetCalls) control.calls.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(control));
  });
  await new Promise((resolve) => controls.listen(0, '127.0.0.1', resolve));
  return {
    app,
    fixture,
    remote,
    main,
    emptyRepo,
    control,
    url: await app.getUrl(),
    controlUrl: `http://127.0.0.1:${controls.address().port}`,
    async close() {
      await app.close();
      await new Promise((resolve) => controls.close(resolve));
      await remote.close();
      fixture.close();
      empty.close();
      globalThis.fetch = originalFetch;
      if (previousDir === undefined) delete process.env.ALUNE_DATA_DIR;
      else process.env.ALUNE_DATA_DIR = previousDir;
    },
  };
}
module.exports = { startPullRequestsFixture };
if (require.main === module) {
  startPullRequestsFixture({
    ...(process.argv[2] ? { webRoot: path.resolve(process.argv[2]) } : {}),
  })
    .then((fixture) => {
      console.log(
        JSON.stringify({
          url: `${fixture.url}/repositories/${fixture.main.id}`,
          emptyUrl: `${fixture.url}/repositories/${fixture.emptyRepo.id}`,
          controlUrl: fixture.controlUrl,
        }),
      );
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => void fixture.close().then(() => process.exit(0)));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
