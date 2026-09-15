const { Server } = require('ssh2');
const { generateKeyPairSync } = require('node:crypto');
const { spawn } = require('node:child_process');

// Loopback-only SSH server for disposable Git repositories; no real credentials or hosts.
exports.startSSHServer = async () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const clients = new Set();
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'test-only')
        ctx.accept();
      else ctx.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        accept().on('exec', (accept, _reject, info) => {
          const channel = accept();
          const child = spawn('/bin/sh', ['-c', info.command], {
            env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
          });
          child.stdout.on('data', (data) => channel.write(data));
          child.stderr.on('data', (data) => channel.stderr.write(data));
          child.on('close', (code) => {
            channel.exit(code ?? 1);
            channel.end();
          });
          channel.on('close', () => {
            if (child.exitCode === null) child.kill();
          });
        });
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    options: {
      host: '127.0.0.1',
      port: server.address().port,
      username: 'fixture',
      password: 'test-only',
    },
    close: async () => {
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
