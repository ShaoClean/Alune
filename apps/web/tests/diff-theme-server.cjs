// Real web acceptance: isolated data, production backend and Git over local/SSH.
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');
const root = mkdtempSync(path.join(tmpdir(), 'alune-diff-web-'));
process.env.ALUNE_DATA_DIR = root;
const { startServer } = require('../../server/dist/bootstrap');
const fixture = createRepository();
let server, remote;
async function close() {
  await server?.close();
  await remote?.close();
  fixture.close();
  rmSync(root, { recursive: true, force: true });
}
(async () => {
  const before =
    '// Alune\nexport function greet(name: string) {\n  /* A multiline\n     comment */\n  const count = 12;\n  return "Hello " + name;\n}\n';
  fixture.write('example.ts', before);
  fixture.write('example.py', '# Alune\nprint("old", 12)\n');
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'test: code theme baseline');
  fixture.write('example.ts', before.replace('12', '42').replace('"Hello "', '"Welcome "'));
  fixture.write('example.py', '# Alune\nprint("new", 42)\n');
  remote = await startSSHServer();
  server = await startServer({
    host: '127.0.0.1',
    port: 0,
    webRoot: path.resolve(__dirname, '../dist'),
  });
  const origin = await server.getUrl();
  const post = async (route, body) => {
    const response = await fetch(origin + '/api' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Error(await response.text());
    return response.json();
  };
  const connection = await post('/connections', {
    ...remote.options,
    name: 'Diff theme SSH',
    authType: 'password',
  });
  const repos = [
    await post('/repositories', { source: 'local', path: fixture.repo }),
    await post('/repositories', { connectionId: connection.id, path: fixture.repo }),
  ];
  console.log(
    JSON.stringify({
      origin,
      repos: repos.map((repo) => ({
        source: repo.source,
        url: origin + '/repositories/' + repo.id,
      })),
    }),
  );
  process.once('SIGTERM', () => close().then(() => process.exit()));
  process.once('SIGINT', () => close().then(() => process.exit()));
})().catch(async (error) => {
  console.error(error);
  await close();
  process.exitCode = 1;
});
