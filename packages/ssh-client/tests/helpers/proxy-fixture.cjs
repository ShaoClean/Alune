const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Server, utils } = require('ssh2');

const certificate = path.join(__dirname, '../fixtures/proxy-test-cert.pem');
const tlsOptions = { key: fs.readFileSync(path.join(__dirname, '../fixtures/proxy-test-key.pem')), cert: fs.readFileSync(certificate) };
async function listen(server, host = '127.0.0.1') {
  const sockets = new Set();
  server.on('connection', (socket) => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, host, resolve));
  return { server, port: server.address().port, close: () => { for (const socket of sockets) { if (typeof socket.destroy === 'function') socket.destroy(); else socket.end(); } server.close(); } };
}

async function httpProxy({ secure = false, credentials, map = (_host, port) => ({ host: '127.0.0.1', port }), status } = {}) {
  const records = [];
  const server = secure ? https.createServer(tlsOptions) : http.createServer();
  server.on('connect', (request, socket, head) => {
    const target = new URL(`http://${request.url}`);
    records.push({ host: target.hostname, port: Number(target.port || 80), authorized: request.headers['proxy-authorization'] });
    const expected = credentials && `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
    if (status || (expected && request.headers['proxy-authorization'] !== expected)) {
      socket.end(`HTTP/1.1 ${status || 407} Refused\r\n\r\n`); return;
    }
    const upstream = net.connect(map(target.hostname, Number(target.port || 80)), () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  });
  return { ...await listen(server), records };
}

async function socksProxy({ credentials, map = (_host, port) => ({ host: '127.0.0.1', port }) } = {}) {
  const records = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0), stage = 'greeting';
    const read = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting') {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        const length = 2 + buffer[1];
        socket.write(Buffer.from([5, credentials ? 2 : 0]));
        buffer = buffer.subarray(length); stage = credentials ? 'auth' : 'connect';
      }
      if (stage === 'auth') {
        if (buffer.length < 2 || buffer.length < 3 + buffer[1]) return;
        const n = buffer[1], m = buffer[2 + n];
        if (buffer.length < 3 + n + m) return;
        const ok = buffer.subarray(2, 2 + n).toString() === credentials.username && buffer.subarray(3 + n, 3 + n + m).toString() === credentials.password;
        socket.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) return socket.end();
        buffer = buffer.subarray(3 + n + m); stage = 'connect';
      }
      if (stage === 'connect') {
        if (buffer.length < 5) return;
        const domain = buffer[3] === 3, length = domain ? buffer[4] + 7 : 10;
        if (buffer.length < length) return;
        const host = domain ? buffer.subarray(5, length - 2).toString() : [...buffer.subarray(4, 8)].join('.');
        const port = buffer.readUInt16BE(length - 2);
        records.push({ host, port, domain }); stage = 'tunnel'; socket.removeListener('data', read);
        const head = buffer.subarray(length);
        const upstream = net.connect(map(host, port), () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 1]));
          if (head.length) upstream.write(head);
          socket.pipe(upstream).pipe(socket);
        });
        upstream.on('error', () => socket.destroy());
        socket.on('close', () => upstream.destroy());
        upstream.on('close', () => socket.destroy());
      }
    };
    socket.on('data', read);
  });
  return { ...await listen(server), records };
}

async function forwardingSSH({ deny = false, wildcard = false, environment = {} } = {}) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const forwards = new Map();
  const clients = new Set();
  const commands = [];
  const server = new Server({ hostKeys: [key] }, (client) => {
    clients.add(client); client.on('error', () => {});
    const owned = new Set();
    client.on('close', () => { clients.delete(client); for (const port of owned) { forwards.get(port)?.close(); forwards.delete(port); } });
    client.on('authentication', (context) => context.accept());
    client.on('request', (accept, reject, name, info) => {
      if (name === 'cancel-tcpip-forward') { forwards.get(info.bindPort)?.close(); forwards.delete(info.bindPort); owned.delete(info.bindPort); accept(); return; }
      if (name !== 'tcpip-forward' || deny) return reject();
      const listener = net.createServer((socket) => {
        client.forwardOut(info.bindAddr, listener.address().port, '127.0.0.1', socket.remotePort, (error, channel) => {
          if (error) return socket.destroy();
          socket.on('error', () => channel.destroy()); channel.on('error', () => socket.destroy());
          socket.on('close', () => channel.destroy()); channel.on('close', () => socket.destroy());
          socket.pipe(channel).pipe(socket);
        });
      });
      listener.listen(0, wildcard ? '0.0.0.0' : info.bindAddr, () => {
        const port = listener.address().port; forwards.set(port, listener); owned.add(port); accept(port);
      });
    });
    client.on('session', (accept) => {
      const session = accept();
      session.on('exec', (accept, _reject, info) => {
        commands.push(info.command);
        const channel = accept();
        const child = spawn(info.command, { shell: true, env: { ...process.env, ...environment } });
        child.stdout.pipe(channel, { end: false }); child.stderr.pipe(channel.stderr, { end: false }); channel.pipe(child.stdin);
        child.stdin.on('error', () => {}); channel.on('error', () => {});
        channel.once('close', () => child.kill());
        child.once('close', (code) => { if (!channel.destroyed) { channel.exit(code ?? 1); channel.end(); } });
      });
    });
  });
  const result = await listen(server);
  return { ...result, forwards, clients, commands, publicKey: utils.parseKey(key).getPublicSSH().toString('base64'), close() { for (const client of clients) client.end(); for (const listener of forwards.values()) listener.close(); result.close(); } };
}

module.exports = { listen, httpProxy, socksProxy, forwardingSSH, tlsOptions, certificate };
