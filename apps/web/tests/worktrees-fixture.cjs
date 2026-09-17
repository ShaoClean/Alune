const fs = require('node:fs');
const path = require('node:path');
const {
  createWorktreeRepository,
} = require('../../../packages/ssh-client/tests/helpers/worktree-repository.cjs');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

// Production HTTP/SQLite/SSH/Git on loopback and disposable directories only.
// Build shared, ssh-client, server and web before starting this fixture.
async function startWorktreesFixture(webRoot = path.resolve(__dirname, '../dist')) {
  const fixture = createWorktreeRepository();
  const empty = createRepository();
  const remote = await startSSHServer();
  const previous = process.env.REMOTE_GIT_DATA_DIR;
  process.env.REMOTE_GIT_DATA_DIR = path.join(fixture.root, 'app-data');
  // Express sendFile rejects hidden checkout ancestors such as .cindy-worktrees.
  // Serve a disposable copy, as a packaged app would, without changing production routing.
  const servedRoot = path.join(fixture.root, 'web');
  fs.cpSync(webRoot, servedRoot, { recursive: true });
  const { startServer } = require('../../server/dist/bootstrap');
  const { ConnectionService } = require('../../server/dist/connection/connection.service');
  const { RepositoryService } = require('../../server/dist/repository/repository.service');
  const app = await startServer({ port: 0, host: '127.0.0.1', webRoot: servedRoot });
  const connection = await app.get(ConnectionService).create({
    ...remote.options,
    name: '隔离测试服务器',
    authType: 'password',
  });
  const repositoryService = app.get(RepositoryService);
  const main = await repositoryService.add(connection.id, fixture.repo);
  const sole = await repositoryService.add(connection.id, empty.repo);
  app
    .get('DATABASE')
    .prepare('UPDATE repositories SET name = ? WHERE id = ?')
    .run('remote-git', main.id);
  app
    .get('DATABASE')
    .prepare('UPDATE repositories SET name = ? WHERE id = ?')
    .run('single-worktree', sole.id);
  return {
    app,
    fixture,
    main,
    sole,
    url: await app.getUrl(),
    async close() {
      await app.close();
      await remote.close();
      fixture.close();
      empty.close();
      if (previous === undefined) delete process.env.REMOTE_GIT_DATA_DIR;
      else process.env.REMOTE_GIT_DATA_DIR = previous;
    },
  };
}
module.exports = { startWorktreesFixture };
if (require.main === module) {
  startWorktreesFixture()
    .then((fixture) => {
      console.log(
        JSON.stringify({
          url: fixture.url + '/repositories/' + fixture.main.id,
          sole: fixture.sole.id,
          root: fixture.fixture.root,
        }),
      );
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => {
          void fixture.close().then(() => process.exit(0));
        });
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
