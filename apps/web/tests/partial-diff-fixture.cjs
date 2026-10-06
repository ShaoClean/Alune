// Production HTTP + UI against a disposable repository for Issue #183 acceptance.
// Build shared, ssh-client, server and web first. No user repositories are touched.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:http');
const { execFileSync } = require('node:child_process');
async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-partial-ui-'));
  process.env.ALUNE_DATA_DIR = path.join(root, 'data');
  process.env.GIT_CONFIG_GLOBAL = path.join(root, 'empty.gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
  const { startServer } = require('../../server/dist/bootstrap');
  const { RepositoryService } = require('../../server/dist/repository/repository.service');
  const repo = path.join(root, 'partial-demo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.autocrlf', 'false');
  const original = Array.from(
    { length: 130 },
    (_, i) => `export const line${i + 1} = ${i + 1};\n`,
  ).join('');
  const write = (text) => fs.writeFileSync(path.join(repo, '中文示例.ts'), text);
  write(original);
  git('add', '.');
  git('commit', '-qm', 'base');
  const seed = () => {
    git('reset', '--hard', 'HEAD');
    write(
      original
        .replace('line3 = 3', 'line3 = 300')
        .replace('line70 = 70', 'line70 = 700')
        .replace('line125 = 125', 'line125 = 1250'),
    );
  };
  seed();
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve(__dirname, '../dist'),
  });
  const record = await app.get(RepositoryService).addLocal(repo);
  const control = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      if (body.reset) seed();
      if (body.edit)
        write(fs.readFileSync(path.join(repo, '中文示例.ts'), 'utf8') + '// external edit\n');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          root,
          repo,
          id: record.id,
          worktree: fs.readFileSync(path.join(repo, '中文示例.ts'), 'utf8'),
          index: git('show', ':中文示例.ts'),
          diff: git('diff'),
          cached: git('diff', '--cached'),
        }),
      );
    } catch (error) {
      res.writeHead(500).end(error.message);
    }
  });
  await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
  const baseUrl = await app.getUrl();
  return {
    url: `${baseUrl}/repositories/${record.id}`,
    controlUrl: `http://127.0.0.1:${control.address().port}`,
    close: async () => {
      await app.close();
      await new Promise((resolve) => control.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
module.exports = { createFixture };
if (require.main === module)
  createFixture().then((fixture) => {
    console.log(JSON.stringify({ url: fixture.url, controlUrl: fixture.controlUrl }));
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, async () => {
        await fixture.close();
        process.exit(0);
      });
  });
