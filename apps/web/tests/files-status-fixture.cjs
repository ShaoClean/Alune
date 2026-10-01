// Real Git states, served through both local and SSH production APIs.
// Build shared, ssh-client, server and web before running.
const fs = require('node:fs');
const path = require('node:path');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

async function createFilesStatusFixture() {
  const fixture = createRepository();
  const previousDir = process.env.ALUNE_DATA_DIR;
  process.env.ALUNE_DATA_DIR = path.join(fixture.root, 'app-data');
  const { startServer } = require('../../server/dist/bootstrap');
  const { ConnectionService } = require('../../server/dist/connection/connection.service');
  const { RepositoryService } = require('../../server/dist/repository/repository.service');
  for (const name of [
    'clean.txt',
    'modified.txt',
    'rename-me.txt',
    'deleted.txt',
    'conflict.txt',
    'src/nested.txt',
  ])
    fixture.write(name, `Original ${name}\n`);
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'File status baseline');
  const main = fixture.git('branch', '--show-current').trim();
  fixture.git('checkout', '-qb', 'other');
  fixture.write('conflict.txt', 'Other branch\n');
  fixture.git('commit', '-qam', 'Other change');
  fixture.git('checkout', '-q', main);
  fixture.write('conflict.txt', 'Current branch\n');
  fixture.git('commit', '-qam', 'Current change');
  try {
    fixture.git('merge', 'other');
  } catch {
    /* Expected real merge conflict. */
  }
  fixture.write('modified.txt', 'Worktree modification\n');
  fixture.write('src/nested.txt', 'Nested modification\n');
  fixture.write('untracked.txt', 'Untracked content\n');
  fixture.write('new folder/新文件.txt', 'Nested untracked content\n');
  fixture.write('added.txt', 'Staged addition\n');
  fixture.git('add', 'added.txt');
  fixture.write('added.txt', 'Staged addition with further worktree edits\n');
  fixture.git('mv', 'rename-me.txt', 'renamed.txt');
  fs.unlinkSync(path.join(fixture.repo, 'deleted.txt'));

  const remote = await startSSHServer();
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve(__dirname, '../dist'),
  });
  const connection = await app
    .get(ConnectionService)
    .create({ ...remote.options, name: '文件状态 SSH 验收', authType: 'password' });
  const repositories = app.get(RepositoryService);
  const local = await repositories.addLocal(fixture.repo);
  const ssh = await repositories.add(connection.id, fixture.repo);
  const url = await app.getUrl();
  return {
    localUrl: `${url}/repositories/${local.id}`,
    sshUrl: `${url}/repositories/${ssh.id}`,
    repo: fixture.repo,
    async close() {
      await app.close();
      await remote.close();
      fixture.close();
      if (previousDir === undefined) delete process.env.ALUNE_DATA_DIR;
      else process.env.ALUNE_DATA_DIR = previousDir;
    },
  };
}

module.exports = { createFilesStatusFixture };
if (require.main === module)
  createFilesStatusFixture()
    .then((fixture) => {
      console.log(
        'FILES_STATUS_FIXTURE ' +
          JSON.stringify({
            localUrl: fixture.localUrl,
            sshUrl: fixture.sshUrl,
            repo: fixture.repo,
          }),
      );
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => fixture.close().then(() => process.exit()));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
