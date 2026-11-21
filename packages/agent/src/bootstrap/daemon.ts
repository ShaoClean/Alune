import { createServer, connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SocketTransport, socketPreface, type ProxyPort } from '@alune/agent-client/node';
import { AgentSession } from '../server/session';
import { openStateKernel } from './state-kernel';

const root = join(homedir(), '.alune-ssh', 'daemon');
const runtime = join(root, 'server-runtime.json');
const loopback = '127.0.0.1';
interface Runtime {
  schemaVersion: number;
  pid: number;
  port: number;
  token: string;
  version: string;
  target: string;
  agentId: string;
  startedAt: string;
}
function readRuntime(): Runtime | undefined {
  try {
    return JSON.parse(fs.readFileSync(runtime, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
function processAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function control(record: Runtime, action: 'probe' | 'stop') {
  // A stale port may now belong to another user. Prove possession before sending credentials.
  const challenge = randomBytes(32).toString('hex');
  const preface = socketPreface(action === 'probe' ? challenge : record.token, action);
  const expected =
    action === 'probe' ? createHmac('sha256', record.token).update(challenge).digest('hex') : 'ok';
  return new Promise<boolean>((resolve) => {
    const socket = connect(record.port, loopback, () => socket.write(preface));
    const timer = setTimeout(() => socket.destroy(), 1000);
    let result = '';
    socket
      .on('data', (b) => {
        result += b;
        if (result.length > 80) socket.destroy();
      })
      .on('error', () => {})
      .once('close', () => {
        clearTimeout(timer);
        resolve(result === expected);
      });
  });
}

// Called under the remote bootstrap's exclusive launch lock.
export async function ensureDaemon(version: string) {
  const old = readRuntime();
  if (old && processAlive(old.pid) && (await control(old, 'probe'))) {
    if (old.version === version) return { ...old, reused: true };
    if (!(await control(old, 'stop'))) throw Error('Daemon shutdown refused');
    for (let i = 0; i < 50 && fs.existsSync(runtime); i++) await delay(100);
    if (fs.existsSync(runtime)) throw Error('Daemon shutdown timed out');
  }
  fs.rmSync(runtime, { force: true });
  const log = join(root, 'server.log');
  if (fs.existsSync(log)) fs.renameSync(log, log + '.previous');
  const fd = fs.openSync(log, 'w', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [process.argv[1], 'serve-daemon'], {
      detached: true,
      stdio: ['ignore', fd, fd],
    });
  } finally {
    fs.closeSync(fd);
  }
  let failure: Error | undefined;
  child.on('error', (e) => {
    failure = e;
  });
  child.unref();
  for (let i = 0; i < 200; i++) {
    if (failure) throw failure;
    if (child.exitCode !== null || child.signalCode) {
      const fd = fs.openSync(log, 'r');
      try {
        const buf = Buffer.alloc(512);
        const n = fs.readSync(
          fd,
          buf,
          0,
          buf.length,
          Math.max(0, fs.fstatSync(fd).size - buf.length),
        );
        throw Error('Daemon exited: ' + buf.toString('utf8', 0, n));
      } finally {
        fs.closeSync(fd);
      }
    }
    const record = readRuntime();
    if (record && record.pid === child.pid && (await control(record, 'probe')))
      return { ...record, reused: false };
    await delay(100);
  }
  child.kill();
  throw Error('Daemon startup timed out');
}

export async function serveDaemon(directory: string, agentId: string, version: string) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  let session: AgentSession | undefined;
  let binding = Promise.resolve();
  const sockets = new Set<Socket>();
  let stopping = false;
  const stop = () => {
    stopping = true;
    server.close();
    for (const socket of sockets) socket.destroy();
  };
  const idle = setTimeout(stop, 20 * 60_000);
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    const deadline = setTimeout(() => socket.destroy(), 5000);
    socket.once('close', () => clearTimeout(deadline));
    const authenticate = () => {
      const bytes: Buffer | null = socket.read(69);
      if (!bytes) return;
      if (bytes.length !== 69) return void socket.destroy();
      socket.off('readable', authenticate);
      clearTimeout(deadline);
      const value = bytes.subarray(64).toString('latin1');
      if (value === 'probe') {
        socket.end(createHmac('sha256', token).update(bytes.subarray(0, 64)).digest('hex'), () =>
          socket.destroy(),
        );
        return;
      }
      if (!timingSafeEqual(bytes.subarray(0, 64), Buffer.from(token))) return void socket.destroy();
      if (value === 'stop!') {
        socket.end('ok', () => {
          socket.destroy();
          stop();
        });
        return;
      }
      if (value !== 'block' && (!/^\d{5}$/.test(value) || Number(value) > 65535))
        return void socket.destroy();

      const gitProxyPort: ProxyPort = value === 'block' ? 'blocked' : Number(value) || undefined;
      binding = binding
        .then(async () => {
          if (socket.destroyed || stopping) return;
          await session?.close();
          const kernel = await openStateKernel(
            directory,
            agentId,
            new AbortController().signal,
            {},
            { gitProxyPort },
          );
          if (socket.destroyed || stopping) {
            await kernel.close();
            return;
          }
          const current = new AgentSession(new SocketTransport(socket), {
            agentId,
            version,
            sshSnapshotChannel: true,
            handlers: kernel.handlers,
            taskJournal: kernel.taskJournal,
            onDispose: kernel.close,
          });
          session = current;
          clearTimeout(idleTimer);
          void current.closed.then(() => {
            if (current === session && !stopping) idleTimer = setTimeout(stop, 20 * 60_000);
          });
          socket.resume();
        })
        .catch(() => {
          socket.destroy();
        });
    };
    socket.on('readable', authenticate);
  });
  let idleTimer = idle;
  await new Promise<void>((resolve, reject) =>
    server.once('error', reject).listen(0, loopback, resolve),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing daemon address');
  const record: Runtime = {
    schemaVersion: 1,
    token,
    pid: process.pid,
    port: address.port,
    version,
    agentId,
    target: process.platform + '-' + process.arch,
    startedAt: new Date().toISOString(),
  };
  const tmp = runtime + '.' + token.slice(0, 16);
  fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, runtime);
  process.once('SIGTERM', stop).once('SIGINT', stop);
  try {
    await new Promise<void>((resolve) => server.once('close', resolve));
    await binding;
    await session?.close();
  } finally {
    clearTimeout(idleTimer);
    process.off('SIGTERM', stop).off('SIGINT', stop);
    if (readRuntime()?.token === token) fs.unlinkSync(runtime);
  }
}
