// Browser acceptance against a real HTTP server and disposable repositories.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-directory-ui-'));
  process.env.ALUNE_DATA_DIR = path.join(root, 'data');
  process.env.GIT_CONFIG_GLOBAL = path.join(root, 'empty.gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
  const { startServer } = require('../../server/dist/bootstrap');
  const { RepositoryService } = require('../../server/dist/repository/repository.service');
  const repo = path.join(root, 'directory-demo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  };
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Alune Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write('src/app.ts', 'export const version = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'initial');
  for (const dir of ['nested repo', 'shared-module']) {
    git('init', '-q', dir);
    git('-C', dir, 'config', 'user.name', 'Alune Fixture');
    git('-C', dir, 'config', 'user.email', 'fixture@example.invalid');
    write(dir + '/readme.md', '# Independent repository\n');
    git('-C', dir, 'add', '.');
    git('-C', dir, 'commit', '-qm', 'initial');
  }
  git('add', 'shared-module');
  git('commit', '-qm', 'track module');
  write('shared-module/readme.md', '# Module update\n');
  git('-C', 'shared-module', 'commit', '-qam', 'update module');
  git('worktree', 'add', '-qb', 'demo-worktree', '.claude/worktrees/demo');
  write('src/app.ts', 'export const version = 2;\n');
  write('notes/new.txt', 'new file\n');
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve(__dirname, '../dist'),
  });
  const record = await app.get(RepositoryService).addLocal(repo);
  return {
    url: `${await app.getUrl()}/repositories/${record.id}`,
    repo,
    close: async () => {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
module.exports = { createFixture };
if (require.main === module)
  createFixture().then((fixture) => {
    console.log('DIRECTORY_UI_FIXTURE ' + JSON.stringify({ url: fixture.url, repo: fixture.repo }));
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => fixture.close().then(() => process.exit()));
  });
