const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const { Server } = require('ssh2');
const pty = require('node-pty');

async function terminalSSH(name) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const clients = new Set();
  const processes = new Set();
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client);
    client.on('error', () => {});
    client.once('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      if (
        ctx.method === 'password' &&
        ctx.username === name &&
        ctx.password === 'test-only'
      )
        ctx.accept();
      else ctx.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        let dimensions;
        let child;
        session.on('pty', (accept, _reject, info) => {
          dimensions = info;
          accept();
        });
        session.on('window-change', (accept, _reject, info) => {
          child?.resize?.(info.cols, info.rows);
          accept?.();
        });
        session.on('exec', (accept, _reject, info) => {
          const channel = accept();
          channel.on('error', () => {});
          const env = {
            ...process.env,
            SHELL: '/bin/sh',
            TEST_SSH_HOST: name,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
          };
          if (dimensions) {
            child = pty.spawn('/bin/sh', ['-c', info.command], {
              cwd: os.tmpdir(),
              env,
              cols: dimensions.cols,
              rows: dimensions.rows,
            });
            processes.add(child);
            child.onData((data) => {
              if (!channel.write(data)) child.pause();
            });
            channel.on('drain', () => child.resume());
            channel.on('data', (data) => child.write(data.toString()));
            child.onExit(({ exitCode }) => {
              processes.delete(child);
              channel.exit(exitCode);
              channel.end();
            });
          } else {
            child = spawn('/bin/sh', ['-c', info.command], { env });
            processes.add(child);
            child.stdout.pipe(channel, { end: false });
            child.stderr.pipe(channel.stderr, { end: false });
            child.on('close', (code) => {
              processes.delete(child);
              channel.exit(code ?? 1);
              channel.end();
            });
          }
          channel.once('close', () => {
            processes.delete(child);
            try {
              child.kill();
            } catch {}
          });
        });
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    options: {
      name,
      host: '127.0.0.1',
      port: server.address().port,
      username: name,
      authType: 'password',
      password: 'test-only',
    },
    processes,
    drop() {
      for (const client of clients) client.end();
    },
    async close() {
      for (const child of processes)
        try {
          child.kill();
        } catch {}
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function createTerminalFixture({
  ssh = process.platform !== 'win32',
  token = randomBytes(24).toString('hex'),
} = {}) {
  const originalShell = process.env.SHELL;
  const originalPrompt = process.env.PS1;
  if (process.platform !== 'win32') process.env.SHELL = '/bin/sh';
  process.env.PS1 = 'ALUNE_TEST> ';
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'alune-terminal-')),
  );
  process.env.ALUNE_DATA_DIR = path.join(root, 'data');
  const seed = (name) => {
    const directory = path.join(root, name);
    fs.mkdirSync(directory, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', directory]);
    execFileSync('git', [
      '-C',
      directory,
      '-c',
      'user.name=Terminal Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'fixture',
    ]);
    return directory;
  };
  const { startServer } = require('../dist/bootstrap');
  const {
    RepositoryService,
  } = require('../dist/repository/repository.service');
  const {
    ConnectionService,
  } = require('../dist/connection/connection.service');
  const { TerminalRegistry } = require('../dist/terminal/terminal-registry');
  const app = await startServer({
    port: 0,
    token,
    webRoot: path.resolve(__dirname, '../../web/dist'),
  });
  const remotes = [];
  const database = app.get('DATABASE');
  const close = async () => {
    await app.close();
    if (database.open) database.close();
    for (const remote of remotes) await remote.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
    if (originalPrompt === undefined) delete process.env.PS1;
    else process.env.PS1 = originalPrompt;
  };
  try {
    const repositories = app.get(RepositoryService);
    const connections = app.get(ConnectionService);
    const repo = await repositories.addLocal(
      seed(
        process.platform === 'win32'
          ? 'local 中文 space'
          : "local 中文 ' $(echo UNSAFE) ; space",
      ),
    );
    const worktreePath = path.join(root, 'worktree 中文');
    execFileSync('git', [
      '-C',
      repo.path,
      'worktree',
      'add',
      '-q',
      '-b',
      'topic',
      worktreePath,
    ]);
    // Use the exact Git-listed path, like the UI does (Git uses / on Windows).
    const listed = await repositories.getWorktrees(repo.id);
    const selectedWorktree = listed.find((item) => item.branch === 'topic');
    if (!selectedWorktree) throw new Error('Fixture Worktree was not listed');
    const worktree = await repositories.openWorktree(
      repo.id,
      selectedWorktree.path,
    );
    const remoteRepos = [];
    if (ssh)
      for (const name of ['ssh-a', 'ssh-b']) {
        const remote = await terminalSSH(name);
        remotes.push(remote);
        const config = await connections.create(remote.options);
        remoteRepos.push(
          await repositories.add(config.id, seed(name + " 中文 ' ; space")),
        );
      }
    const address = app.getHttpServer().address();
    return {
      app,
      root,
      token,
      repo,
      worktree,
      remotes,
      remoteRepos,
      repositories,
      connections,
      registry: app.get(TerminalRegistry),
      url: `http://127.0.0.1:${address.port}`,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
module.exports = { createTerminalFixture, terminalSSH };
