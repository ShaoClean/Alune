const { createServer } = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GitCommands, GitLogChangedError } = require('../../../packages/ssh-client/dist');
const {
  createHistoryRepository,
} = require('../../../packages/ssh-client/tests/helpers/history-repository.cjs');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');

// Browser acceptance uses real, isolated Git history through production readers.
// No configured connections, user repositories or credentials are accessed.
async function startHistoryFixture(root = path.resolve(__dirname, '../dist'), legacy = false) {
  const history = createHistoryRepository();
  const empty = createRepository({ initial: false });
  const fixtures = { history: history, empty: empty };
  const repositories = [
    { id: 'history', connectionId: 'fixture', name: 'remote-git', path: '/workspace/remote-git' },
    { id: 'empty', connectionId: 'fixture', name: 'empty-repo', path: '/workspace/empty-repo' },
  ];
  let failNext = false;
  const json = (res, value, status = 200) =>
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/__fixture/info')
        return json(res, {
          merge: history.merge,
          feature: history.feature,
          total: Number(history.git('rev-list', '--all', '--count')),
        });
      if (req.method === 'POST' && url.pathname === '/__fixture/change') {
        history.git('commit', '--allow-empty', '-qm', 'feat: 浏览期间新增提交');
        return json(res, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/__fixture/fail-next') {
        failNext = true;
        return json(res, { ok: true });
      }
      if (url.pathname === '/api/ai/settings')
        return json(res, {
          revision: 'fixture',
          providers: [],
          commit: {
            providerId: null,
            modelId: null,
            language: 'zh-CN',
            format: 'conventional',
            prompt: '',
          },
          secretStorage: { available: true, description: '隔离验收环境' },
        });
      if (url.pathname === '/api/connections')
        return json(res, [
          {
            id: 'fixture',
            name: '开发服务器',
            host: 'fixture.invalid',
            port: 22,
            username: 'fixture',
            authType: 'sshAgent',
          },
        ]);
      if (url.pathname === '/api/repositories') return json(res, repositories);
      if (url.pathname.startsWith('/api/repositories/')) {
        const [, , , id, operation] = url.pathname.split('/');
        const fixture = fixtures[id];
        if (!fixture) return json(res, { message: 'Unknown fixture' }, 404);
        const git = new GitCommands(fixture.connection);
        if (!operation)
          return json(
            res,
            repositories.find((item) => item.id === id),
          );
        if (operation === 'status')
          return json(res, { branch: 'main', ahead: 0, behind: 0, files: [] });
        if (operation === 'log') {
          if (failNext) {
            failNext = false;
            return json(res, { message: '模拟 SSH 连接暂时中断，请重试。' }, 502);
          }
          const page = await git.log(fixture.repo, {
            ...Object.fromEntries(url.searchParams),
            ...(legacy ? { branch: 'main' } : {}),
          });
          return json(res, legacy ? page.commits : page);
        }
        if (operation === 'commit-files')
          return json(res, await git.commitFiles(fixture.repo, url.searchParams.get('commit')));
        if (operation === 'diff')
          return json(res, await git.diff(fixture.repo, Object.fromEntries(url.searchParams)));
        return json(res, []);
      }
      if (url.pathname.startsWith('/api/')) return json(res, []);
      const filename = path.resolve(
        root,
        url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg'
          ? '.' + url.pathname
          : 'index.html',
      );
      if (path.relative(root, filename).startsWith('..')) {
        res.writeHead(403).end();
        return;
      }
      const content = await fs.readFile(filename);
      const type = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.svg': 'image/svg+xml',
      }[path.extname(filename)];
      res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }).end(content);
    } catch (error) {
      json(
        res,
        {
          message: error.message,
          ...(error instanceof GitLogChangedError ? { code: 'HISTORY_CHANGED' } : {}),
        },
        error instanceof GitLogChangedError ? 409 : 500,
      );
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      history.close();
      empty.close();
    },
  };
}
module.exports = { startHistoryFixture };
if (require.main === module)
  startHistoryFixture(process.argv[2], process.env.HISTORY_FIXTURE_LEGACY === '1').then(
    (fixture) => {
      console.log(fixture.origin);
      for (const signal of ['SIGTERM', 'SIGINT'])
        process.on(signal, async () => {
          await fixture.close();
          process.exit(0);
        });
    },
  );
