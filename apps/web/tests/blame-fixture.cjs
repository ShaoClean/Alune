// Real, disposable Git history shared by HTTP integration and browser acceptance.
const path = require('node:path');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

async function createBlameFixture() {
  const fixture = createRepository();
  const previousDir = process.env.ALUNE_DATA_DIR;
  process.env.ALUNE_DATA_DIR = path.join(fixture.root, 'app-data');
  const { startServer } = require('../../server/dist/bootstrap');
  const { ConnectionService } = require('../../server/dist/connection/connection.service');
  const { RepositoryService } = require('../../server/dist/repository/repository.service');
  const git = (...args) => fixture.git(...args).trim();
  const before = '原文件.ts';
  const file = '追溯示例.ts';
  fixture.write(
    before,
    '// 文件预览逐行追溯\nexport const version = 1;\nexport const enabled = true;\n\nexport function greet(name: string) {\n  return `你好，${name}`;\n}\n',
  );
  git('add', '.');
  git(
    '-c',
    'user.name=Alice',
    'commit',
    '-qm',
    'feat: 添加问候功能\n\n完整提交说明：初始版本，支持中文姓名。',
  );
  const first = git('rev-parse', 'HEAD');
  git('mv', before, file);
  fixture.write(
    file,
    '// 文件预览逐行追溯\nexport const version = 2;\nexport const enabled = true;\n\nexport function greet(name: string) {\n  return `你好，${name}`;\n}\n',
  );
  git(
    '-c',
    'user.name=Bob',
    'commit',
    '-qam',
    'feat: 更新版本并重命名\n\n保留问候函数，更新版本号。',
  );
  const edited = git('rev-parse', 'HEAD');
  fixture.write(
    file,
    '// 文件预览逐行追溯\nexport const version = 2;\nexport const enabled = true;\n\nexport function greet(name: string) {\n    return `你好，${name}`;\n}\n',
  );
  git('-c', 'user.name=Formatter', 'commit', '-qam', 'style: 格式化缩进');
  const format = git('rev-parse', 'HEAD');
  fixture.write('.git-blame-ignore-revs', `# Format-only commit\n${format}\n`);
  fixture.write('README.md', '# 逐行追溯验收\n\nMarkdown 源码也能开启追溯。\n');
  git('add', '.');
  git('commit', '-qm', 'chore: 忽略格式化提交');
  // Ensure the blamed commit is outside the initial 50-entry history page.
  for (let i = 0; i < 55; i++) git('commit', '--allow-empty', '-qm', `later history ${i}`);
  const worktreePath = path.join(fixture.root, 'linked worktree');
  git('worktree', 'add', '--detach', worktreePath, 'HEAD');
  fixture.write(
    file,
    '// 文件预览逐行追溯\nexport const version = 2;\nexport const enabled = true;\n\nexport function greet(name: string) {\n    return `你好，${name}`;\n}\n// 未提交的尾行\n',
  );
  fixture.write('新文件.txt', '尚未提交\n');
  fixture.write('二进制.dat', Buffer.from([0, 1, 2]));
  fixture.write('大文件.txt', 'a\n'.repeat(5001));
  const remote = await startSSHServer();
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve(__dirname, '../dist'),
  });
  const connection = await app
    .get(ConnectionService)
    .create({ ...remote.options, name: 'Blame SSH 验收', authType: 'password' });
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
    first,
    edited,
    format,
    file,
    repo: fixture.repo,
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
module.exports = { createBlameFixture };
if (require.main === module)
  createBlameFixture()
    .then((fixture) => {
      console.log(
        'BLAME_FIXTURE ' +
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
