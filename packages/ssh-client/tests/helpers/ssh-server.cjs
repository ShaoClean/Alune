// The server is shared; this adapter specifically exercises the legacy SSH client.
const { generateKeyPairSync } = require('node:crypto');
const { Server } = require('ssh2');
const { SSHConnection } = require('../../dist/connection-manager');
const { attachSftp, startSSHServer } = require('../../../agent/tests/helpers/ssh-server.cjs');

async function connectFixture(fixture, { maxSessions = Infinity } = {}) {
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  });
  const clients = new Set();
  const sessions = { active: 0, peak: 0, rejected: 0 };
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => ctx.accept());
    client.on('ready', () =>
      client.on('session', (accept, reject) => {
        if (sessions.active >= maxSessions) {
          sessions.rejected++;
          reject();
          return;
        }
        sessions.active++;
        sessions.peak = Math.max(sessions.peak, sessions.active);
        const session = accept();
        session.once('close', () => sessions.active--);
        session.on('exec', (accept, reject, info) => {
          const channel = accept();
          channel.resume();
          fixture.connection.execCommand(info.command).then(
            (result) => {
              channel.write(result.stdout);
              channel.stderr.write(result.stderr);
              channel.exit(result.exitCode);
              channel.end();
            },
            () => {
              channel.exit(1);
              channel.end();
            },
          );
        });
        attachSftp(session);
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const connection = new SSHConnection({
    host: '127.0.0.1',
    port: server.address().port,
    username: 'fixture',
    password: 'fixture',
  });
  connection.on('error', () => {});
  await connection.connect();
  return {
    connection,
    sessions,
    close: async () => {
      connection.disconnect();
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { connectFixture, startSSHServer };
