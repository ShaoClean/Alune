// Real local Git preview with an isolated registry and disposable repositories.
// Build shared/ssh-client/server/web first, then run this file from the repo root.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-local-ui-'));
process.env.ALUNE_DATA_DIR = path.join(root, 'data');
process.env.GIT_CONFIG_GLOBAL = path.join(root, 'empty.gitconfig');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
process.env.GIT_CONFIG_NOSYSTEM = '1';
const { startServer } = require('../dist/bootstrap');
const { RepositoryService } = require('../dist/repository/repository.service');
const seed = (name, initial) => {
  const repo = path.join(root, name);
  fs.mkdirSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  if (initial) {
    git('config', 'user.name', 'Alune Demo');
    git('config', 'user.email', 'demo@example.invalid');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(
      path.join(repo, 'README.md'),
      '# Alune Demo\n\nA local Git workspace.\n',
    );
    fs.writeFileSync(
      path.join(repo, 'src/main.ts'),
      "export const workspace = { source: 'ssh', name: 'Alune' };\n",
    );
    git('add', '.');
    git('commit', '-qm', 'feat: add workspace');
    fs.writeFileSync(
      path.join(repo, 'src/main.ts'),
      "export const workspace = {\n  source: 'local',\n  name: 'Alune',\n  worktrees: true,\n};\n",
    );
    fs.appendFileSync(
      path.join(repo, 'README.md'),
      '\nOpen a local repository and start working.\n',
    );
    git('add', 'README.md');
    fs.writeFileSync(
      path.join(repo, 'notes.md'),
      '# Next steps\n\nTry staging and committing.\n',
    );
  } else
    fs.writeFileSync(path.join(repo, 'README.md'), '# My first repository\n');
  return repo;
};
(async () => {
  const repo = seed('alune-demo', true);
  const unborn = seed('first-repository', false);
  const bare = path.join(root, 'origin.git');
  fs.mkdirSync(bare);
  execFileSync('git', ['-C', bare, 'init', '-q', '--bare', '-b', 'main']);
  const app = await startServer({
    port: Number(process.env.ALUNE_UI_PORT || 59482),
    host: '127.0.0.1',
    webRoot: path.resolve(__dirname, '../../web/dist'),
  });
  const record = await app.get(RepositoryService).addLocal(repo);
  console.log(
    'LOCAL_UI_FIXTURE ' +
      JSON.stringify({
        root,
        repo,
        unborn,
        bare,
        url: `http://127.0.0.1:${process.env.ALUNE_UI_PORT || 59482}/repositories/${record.id}`,
      }),
  );
  const close = async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
})().catch((error) => {
  console.error(error);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
