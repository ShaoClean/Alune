// Real HTTP/Git/UI acceptance fixture. All writes are confined to disposable repos.
// Build shared, ssh-client, server and web, then run this file from the repo root.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createServer } = require('node:http');

async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-discard-ui-'));
  process.env.ALUNE_DATA_DIR = path.join(root, 'data');
  process.env.GIT_CONFIG_GLOBAL = path.join(root, 'empty.gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
  const { startServer } = require('../../server/dist/bootstrap');
  const { RepositoryService } = require('../../server/dist/repository/repository.service');
  const { GitService } = require('../../server/dist/git/git.service');
  const { LocalConnection } = require('@alune/ssh-client');
  const repo = path.join(root, 'discard-demo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  const write = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Alune Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write('src/mixed.ts', 'export const version = 1;\n');
  write('deleted.txt', 'restore me\n');
  write('.gitignore', 'ignored/\n');
  git('add', '.');
  git('commit', '-qm', 'initial');
  const seed = () => {
    git('reset', '--hard', 'HEAD');
    write('src/mixed.ts', 'export const version = 2;\n');
    write('new-staged.ts', 'export const staged = true;\n');
    write('staged-only.txt', 'keep staged\n');
    git('add', '--', 'src/mixed.ts', 'new-staged.ts', 'staged-only.txt');
    write('src/mixed.ts', 'export const version = 3;\n');
    write('new-staged.ts', 'export const staged = false;\n');
    fs.unlinkSync(path.join(repo, 'deleted.txt'));
    write('notes/one.txt', 'first untracked file\n');
    write('notes/two.txt', 'second untracked file\n');
    write('ignored/keep.txt', 'keep ignored\n');
  };
  seed();
  const control = { calls: 0, delayMs: 0, failUnlink: false };
  const withSftp = LocalConnection.prototype.withSftp;
  LocalConnection.prototype.withSftp = function (operation) {
    return withSftp.call(this, (files) =>
      operation({
        ...files,
        unlink(filename, done) {
          if (control.failUnlink && filename.endsWith('/notes/two.txt')) {
            done(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
          } else files.unlink(filename, done);
        },
      }),
    );
  };
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    webRoot: process.env.ALUNE_DISCARD_WEB_ROOT || path.resolve(__dirname, '../dist'),
  });
  const record = await app.get(RepositoryService).addLocal(repo);
  const service = app.get(GitService);
  const discard = service.discardChanges.bind(service);
  service.discardChanges = async (...args) => {
    control.calls++;
    if (control.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
    return discard(...args);
  };
  // Test-only controls: deterministic latency/failures and same-status edits.
  const controls = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    if (body.reset) {
      seed();
      control.calls = 0;
    }
    if (body.edit) write('src/mixed.ts', 'export const version = 4;\n');
    for (const key of ['delayMs', 'failUnlink']) if (key in body) control[key] = body[key];
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        control,
        index: git('ls-files', '--stage', '-z'),
        status: git('--no-optional-locks', 'status', '--porcelain=v2', '-z', '-uall'),
        mixed: fs.readFileSync(path.join(repo, 'src/mixed.ts'), 'utf8'),
        one: fs.existsSync(path.join(repo, 'notes/one.txt')),
        two: fs.existsSync(path.join(repo, 'notes/two.txt')),
        ignored: fs.readFileSync(path.join(repo, 'ignored/keep.txt'), 'utf8'),
      }),
    );
  });
  await new Promise((resolve) => controls.listen(0, '127.0.0.1', resolve));
  return {
    url: `${await app.getUrl()}/repositories/${record.id}`,
    repo,
    controlUrl: `http://127.0.0.1:${controls.address().port}`,
    close: async () => {
      controls.closeAllConnections();
      await new Promise((resolve) => controls.close(resolve));
      await app.close();
      LocalConnection.prototype.withSftp = withSftp;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

module.exports = { createFixture };
if (require.main === module)
  createFixture().then((fixture) => {
    console.log(
      'DISCARD_UI_FIXTURE ' +
        JSON.stringify({ url: fixture.url, repo: fixture.repo, controlUrl: fixture.controlUrl }),
    );
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => fixture.close().then(() => process.exit()));
  });
