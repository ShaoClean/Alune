// Real, disposable history with several authors, branches and a file renamed
// twice, shared by HTTP integration and browser acceptance of history filters.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

const DAY = 86400;
const START = 1767225600; // 2026-01-01T00:00:00Z

async function createHistoryFilterFixture() {
  const fixture = createRepository();
  const previousDir = process.env.ALUNE_DATA_DIR;
  process.env.ALUNE_DATA_DIR = path.join(fixture.root, 'app-data');
  const { startServer } = require('../../server/dist/bootstrap');
  const { ConnectionService } = require('../../server/dist/connection/connection.service');
  const { RepositoryService } = require('../../server/dist/repository/repository.service');
  const git = (...args) => fixture.git(...args).trim();
  const commit = (message, author, day, files = {}) => {
    for (const [name, contents] of Object.entries(files)) fixture.write(name, contents);
    git('add', '-A');
    const date = '@' + (START + day * DAY) + ' +0800';
    const email = author.toLowerCase() + '@example.invalid';
    execFileSync('git', ['-C', fixture.repo, 'commit', '-q', '--allow-empty', '-m', message], {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: author,
        GIT_AUTHOR_EMAIL: email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: author,
        GIT_COMMITTER_EMAIL: email,
        GIT_COMMITTER_DATE: date,
      },
    });
    return git('rev-parse', 'HEAD');
  };
  git('branch', '-M', 'main');
  const created = commit('feat: 新增解析器', 'Alice', 1, {
    'src/parser.ts': 'export const parse = (text: string) => text.split("\\n");\n',
  });
  commit('fix: 修复 Parser 空行', 'Bob', 2, {
    'src/parser.ts': 'export const parse = (text: string) => text.split("\\n").filter(Boolean);\n',
  });
  commit('docs: 补充 README', 'Carol', 3, { 'README.md': '# 历史筛选验收\n' });
  git('mv', 'src/parser.ts', 'src/reader.ts');
  const renamed = commit('refactor: 重命名解析器', 'Alice', 4);
  git('checkout', '-qb', 'feature/side');
  const side = commit('feat: 侧分支改动 parser 文档', 'Bob', 5, { 'docs/side.md': '侧分支\n' });
  git('checkout', '-q', 'main');
  commit('fix: reader 边界处理', 'Carol', 6, {
    'src/reader.ts':
      'export const parse = (text: string) => text.split(/\\r?\\n/).filter(Boolean);\n',
  });
  git('mv', 'src/reader.ts', 'src/scanner.ts');
  commit('refactor: 再次重命名为 scanner', 'Bob', 7);
  git('merge', '--no-ff', '-qm', 'merge: 合并侧分支', 'feature/side');
  // Push the early history past the first 50-commit page.
  for (let i = 0; i < 60; i++) commit(`chore: 后续提交 ${i}`, i % 2 ? 'Alice' : 'Dave', 10 + i);
  const worktreePath = path.join(fixture.root, 'linked worktree');
  git('worktree', 'add', '--detach', worktreePath, 'HEAD');
  const remote = await startSSHServer();
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve(__dirname, '../dist'),
  });
  const connection = await app
    .get(ConnectionService)
    .create({ ...remote.options, name: '历史筛选 SSH 验收', authType: 'password' });
  const repositories = app.get(RepositoryService);
  const local = await repositories.addLocal(fixture.repo);
  const ssh = await repositories.add(connection.id, fixture.repo);
  const worktree = await repositories.addLocal(worktreePath);
  const url = await app.getUrl();
  return {
    url,
    local,
    ssh,
    worktree,
    created,
    renamed,
    side,
    start: START,
    day: DAY,
    file: 'src/scanner.ts',
    repo: fixture.repo,
    git,
    localUrl: `${url}/repositories/${local.id}`,
    sshUrl: `${url}/repositories/${ssh.id}`,
    async close() {
      await app.close();
      await remote.close();
      fixture.close();
      if (previousDir === undefined) delete process.env.ALUNE_DATA_DIR;
      else process.env.ALUNE_DATA_DIR = previousDir;
    },
  };
}
module.exports = { createHistoryFilterFixture };
if (require.main === module)
  createHistoryFilterFixture()
    .then((fixture) => {
      console.log(
        'HISTORY_FILTER_FIXTURE ' +
          JSON.stringify({
            localUrl: fixture.localUrl,
            sshUrl: fixture.sshUrl,
            worktreeUrl: `${fixture.url}/repositories/${fixture.worktree.id}`,
            repo: fixture.repo,
          }),
      );
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => fixture.close().then(() => process.exit()));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
