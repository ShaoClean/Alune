const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

async function createSigningFixture() {
  const f = createRepository();
  const previous = process.env.ALUNE_DATA_DIR;
  process.env.ALUNE_DATA_DIR = path.join(f.root, 'app-data');
  process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  const key = path.join(f.root, 'signing-key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  const allowed = path.join(f.root, 'allowed-signers');
  fs.writeFileSync(allowed, 'fixture@example.invalid ' + fs.readFileSync(key + '.pub', 'utf8'));
  f.git('config', 'gpg.format', 'ssh');
  f.git('config', 'user.signingkey', key);
  f.git('config', 'gpg.ssh.allowedSignersFile', allowed);
  f.git('config', 'commit.gpgsign', 'true');
  f.write('tracked.txt', 'signed\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'feat: 验证签名提交');
  const signed = f.git('rev-parse', 'HEAD').trim();
  const raw = f
    .git('cat-file', 'commit', signed)
    .replace('feat: 验证签名提交', 'fix: 已篡改的签名示例');
  const invalid = execFileSync(
    'git',
    ['-C', f.repo, 'hash-object', '-w', '-t', 'commit', '--stdin'],
    { input: raw, encoding: 'utf8' },
  ).trim();
  f.git('branch', 'invalid-signature', invalid);
  f.write('tracked.txt', 'ready to sign\n');
  f.git('add', '.');
  const { startServer } = require('../../server/dist/bootstrap');
  const { RepositoryService } = require('../../server/dist/repository/repository.service');
  const { ConnectionService } = require('../../server/dist/connection/connection.service');
  const remote = await startSSHServer();
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve(__dirname, '../dist'),
  });
  const connection = await app
    .get(ConnectionService)
    .create({ ...remote.options, name: '签名 SSH 验收', authType: 'password' });
  const repos = app.get(RepositoryService);
  const local = await repos.addLocal(f.repo);
  const ssh = await repos.add(connection.id, f.repo);
  const url = await app.getUrl();
  return {
    ...f,
    key,
    allowed,
    signed,
    invalid,
    local,
    ssh,
    url,
    async close() {
      await app.close();
      await remote.close();
      f.close();
      if (previous === undefined) delete process.env.ALUNE_DATA_DIR;
      else process.env.ALUNE_DATA_DIR = previous;
    },
  };
}
module.exports = { createSigningFixture };
if (require.main === module)
  createSigningFixture()
    .then((f) => {
      console.log(
        'SIGNING_FIXTURE ' +
          JSON.stringify({
            localUrl: `${f.url}/repositories/${f.local.id}`,
            sshUrl: `${f.url}/repositories/${f.ssh.id}`,
            key: f.key,
            repo: f.repo,
          }),
      );
      for (const event of ['SIGINT', 'SIGTERM'])
        process.once(event, async () => {
          await f.close();
          process.exit(0);
        });
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
