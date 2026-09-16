const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { generateKeyPairSync } = require('node:crypto');
const {
  Server,
  utils: {
    sftp: { STATUS_CODE },
  },
} = require('ssh2');
const { SSHConnection } = require('../../dist/connection-manager');

function attachSftp(session) {
  session.on('sftp', (accept) => {
    const sftp = accept();
    const handles = new Map();
    let nextHandle = 0;
    const failure = (id, error) =>
      sftp.status(
        id,
        error.code === 'ENOENT'
          ? STATUS_CODE.NO_SUCH_FILE
          : error.code === 'EACCES'
            ? STATUS_CODE.PERMISSION_DENIED
            : STATUS_CODE.FAILURE,
        error.message,
      );
    const attrs = (stat) => ({
      mode: stat.mode,
      uid: stat.uid,
      gid: stat.gid,
      size: stat.size,
      atime: Math.floor(stat.atimeMs / 1000),
      mtime: Math.floor(stat.mtimeMs / 1000),
    });
    sftp.on('REALPATH', (id, filename) =>
      fs.realpath(filename, (error, resolved) =>
        error
          ? failure(id, error)
          : sftp.name(id, [{ filename: resolved, longname: resolved, attrs: {} }]),
      ),
    );
    sftp.on('READLINK', (id, filename) =>
      fs.readlink(filename, (error, resolved) =>
        error
          ? failure(id, error)
          : sftp.name(id, [{ filename: resolved, longname: resolved, attrs: {} }]),
      ),
    );
    sftp.on('LSTAT', (id, filename) =>
      fs.lstat(filename, (error, stat) =>
        error ? failure(id, error) : sftp.attrs(id, attrs(stat)),
      ),
    );
    sftp.on('STAT', (id, filename) =>
      fs.stat(filename, (error, stat) =>
        error ? failure(id, error) : sftp.attrs(id, attrs(stat)),
      ),
    );
    sftp.on('REMOVE', (id, filename) =>
      fs.unlink(filename, (error) =>
        error ? failure(id, error) : sftp.status(id, STATUS_CODE.OK),
      ),
    );
    sftp.on('OPEN', (id, filename) =>
      fs.open(filename, 'r', (error, descriptor) => {
        if (error) return failure(id, error);
        const handle = Buffer.alloc(4);
        handle.writeUInt32BE(nextHandle++);
        handles.set(handle.readUInt32BE(), descriptor);
        sftp.handle(id, handle);
      }),
    );
    sftp.on('FSTAT', (id, handle) =>
      fs.fstat(handles.get(handle.readUInt32BE()), (error, stat) =>
        error ? failure(id, error) : sftp.attrs(id, attrs(stat)),
      ),
    );
    sftp.on('READ', (id, handle, offset, length) => {
      const buffer = Buffer.alloc(length);
      fs.read(
        handles.get(handle.readUInt32BE()),
        buffer,
        0,
        length,
        offset,
        (error, bytes) => {
          if (error) failure(id, error);
          else if (!bytes) sftp.status(id, STATUS_CODE.EOF);
          else sftp.data(id, buffer.subarray(0, bytes));
        },
      );
    });
    sftp.on('CLOSE', (id, handle) => {
      const key = handle.readUInt32BE();
      fs.close(handles.get(key), (error) =>
        error ? failure(id, error) : sftp.status(id, STATUS_CODE.OK),
      );
      handles.delete(key);
    });
    sftp.on('close', () => {
      for (const descriptor of handles.values()) fs.close(descriptor, () => {});
    });
  });
}

async function connectFixture(fixture) {
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  });
  const clients = new Set();
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => ctx.accept());
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (accept, reject, info) => {
          const channel = accept();
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
    close: async () => {
      connection.disconnect();
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// Loopback-only SSH server for disposable Git repositories; no real credentials or hosts.
async function startSSHServer() {
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
        const session = accept();
        attachSftp(session);
        session.on('exec', (accept, _reject, info) => {
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
}

module.exports = { connectFixture, startSSHServer };
