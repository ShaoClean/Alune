import Database from 'better-sqlite3';
import { createServer, connect, type Socket } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SocketTransport, socketPreface, type ProxyPort } from '@alune/agent-client/node';
import { AgentHost } from '../server/host';

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

async function control(record: Runtime, action: 'probe' | 'stop' | 'idle') {
  // A stale port may now belong to another user. Prove possession before sending credentials.
  const challenge = randomBytes(32).toString('hex');
  const preface =
    action === 'idle'
      ? record.token + 'idle?'
      : socketPreface(action === 'probe' ? challenge : record.token, action);
  const expected =
    action === 'probe' ? createHmac('sha256', record.token).update(challenge).digest('hex') : 'ok';
  return new Promise<string>((resolve) => {
    const socket = connect(record.port, loopback, () => socket.write(preface));
    const timer = setTimeout(() => socket.destroy(), 1000);
    let result = '';
    socket
      .on('data', (b) => {
        result += b;
        if (result.length > 65536) socket.destroy();
      })
      .on('error', () => {})
      .once('close', () => {
        clearTimeout(timer);
        resolve(result === expected ? 'ok' : action === 'idle' ? result : '');
      });
  });
}

// CLI invocations and SSH launchers share the lock. SQLite releases it if a
// launcher exits abruptly, including on Windows.
export async function daemonControl<T>(operation: () => Promise<T>): Promise<T> {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = new Database(join(root, 'control.sqlite'), { timeout: 30000 });
  try {
    lock.exec('BEGIN EXCLUSIVE');
    return await operation();
  } finally {
    lock.close();
  }
}

export function trackStdioVersion(version: string) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = join(root, 'stdio-' + process.pid);
  fs.writeFileSync(file, version, { mode: 0o600 });
  return () => fs.rmSync(file, { force: true });
}

// Called under the remote bootstrap's exclusive launch lock.
export async function ensureDaemon(version: string, confirmedPid?: number) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const old = readRuntime();
  if (old && processAlive(old.pid)) {
    if (!(await control(old, 'probe'))) throw Error('无法验证现有远端 Agent，请查看日志后重试');
    if (old.version === version) return { ...old, reused: true };
    const result = await control(old, confirmedPid === old.pid ? 'stop' : 'idle');
    if (result !== 'ok')
      return { upgradeRequired: old.pid, activity: result || '旧版 Agent 无法报告活跃会话' };
    for (let i = 0; i < 50 && fs.existsSync(runtime); i++) await delay(100);
    if (fs.existsSync(runtime)) throw Error('Daemon shutdown timed out');
  }
  fs.rmSync(runtime, { force: true });
  const log = join(root, 'server.log');
  if (fs.existsSync(log)) fs.renameSync(log, log + '.previous');
  if (process.platform === 'win32') {
    // WMI starts the process outside the OpenSSH session job. The launcher owns
    // its output file and the daemon creates ConPTY handles in that process tree.
    const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
    const environment = ['$env:USERPROFILE=' + literal(homedir())];
    if (process.env.ALUNE_AGENT_DATA_DIR)
      environment.push('$env:ALUNE_AGENT_DATA_DIR=' + literal(process.env.ALUNE_AGENT_DATA_DIR));
    const script = `${environment.join(';')}; & ${literal(process.execPath)} ${literal(process.argv[1])} serve-daemon *> ${literal(log)}`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$ErrorActionPreference='Stop'; $r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}'}; if ($r.ReturnValue -ne 0) {exit 1}`,
        ],
        { timeout: 15000, windowsHide: true, stdio: 'ignore' },
      );
    } catch (error) {
      if ((error as { status?: number }).status === 1) throw Error('WMI_UNAVAILABLE');
      throw error;
    }
    for (let i = 0; i < 200; i++) {
      const record = readRuntime();
      if (record?.version === version && (await control(record, 'probe')))
        return { ...record, reused: false };
      await delay(100);
    }
    throw Error('Windows 常驻进程启动超时');
  }
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

export const daemonActions = ['logs', 'versions', 'clean', 'restart', 'stop'] as const;
export type DaemonAction = (typeof daemonActions)[number];
export async function manageDaemon(action: DaemonAction, version: string) {
  const record = readRuntime();
  if (action === 'stop' || action === 'restart') {
    if (record && processAlive(record.pid)) {
      if (!(await control(record, 'probe')) || !(await control(record, 'stop')))
        throw Error('远端 Agent 拒绝停止');
      for (let i = 0; i < 50 && fs.existsSync(runtime); i++) await delay(100);
      if (fs.existsSync(runtime)) throw Error('远端 Agent 停止超时');
    }
    if (action === 'restart') await ensureDaemon(version);
    return action === 'stop' ? '远端 Agent 已停止' : '远端 Agent 已重启';
  }
  if (action === 'logs') {
    const log = join(root, 'server.log');
    if (!fs.existsSync(log)) return '暂无日志';
    const fd = fs.openSync(log, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(
        fd,
        buf,
        0,
        buf.length,
        Math.max(0, fs.fstatSync(fd).size - buf.length),
      );
      return (
        buf
          .toString(process.platform === 'win32' ? 'utf16le' : 'utf8', 0, n)
          .replace(/^\uFEFF/, '') || '暂无日志'
      );
    } finally {
      fs.closeSync(fd);
    }
  }
  const versions = join(dirname(root), 'runtime', 'versions');
  if (!fs.existsSync(versions)) return '暂无版本缓存';
  const activeVersions = new Set([version, record?.version]);
  for (const file of fs.readdirSync(root)) {
    const match = /^stdio-(\d+)$/.exec(file);
    if (!match) continue;
    if (processAlive(Number(match[1])))
      activeVersions.add(fs.readFileSync(join(root, file), 'utf8'));
  }
  const rows = [];
  for (const entry of fs.readdirSync(versions, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/.test(entry.name))
      continue;
    const dir = join(versions, entry.name);
    const protectedVersion = activeVersions.has(entry.name);
    if (action === 'clean' && !protectedVersion) {
      // Only remove completed installations. Preserve installers and staging siblings.
      for (const target of fs.readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, target.name);
        if (
          target.isDirectory() &&
          ['win32-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64'].includes(target.name) &&
          fs.existsSync(join(path, '.install-complete')) &&
          (process.platform === 'win32' || !fs.existsSync(path + '.lock'))
        ) {
          if (process.platform === 'win32') {
            const command =
              "$ErrorActionPreference='Stop'; try {$lock=[IO.File]::Open($env:ALUNE_GC_PATH+'.lock','OpenOrCreate','ReadWrite','None')} catch [IO.IOException] {exit 0}; try {[IO.Directory]::Move($env:ALUNE_GC_PATH,$env:ALUNE_GC_TRASH)} finally {$lock.Dispose()}";
            const trash = path + '.gc-' + randomBytes(8).toString('hex');
            execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
              env: { ...process.env, ALUNE_GC_PATH: path, ALUNE_GC_TRASH: trash },
              windowsHide: true,
            });
            fs.rmSync(trash, { recursive: true, force: true });
          } else fs.rmSync(path, { recursive: true });
        }
      }
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
    }
    if (fs.existsSync(dir)) {
      const size = async (directory: string): Promise<number> => {
        let bytes = 0;
        for (const child of await fs.promises.readdir(directory, { withFileTypes: true })) {
          const path = join(directory, child.name);
          if (child.isFile()) bytes += (await fs.promises.lstat(path)).size;
          else if (child.isDirectory()) bytes += await size(path);
        }
        return bytes;
      };
      rows.push(
        entry.name +
          ' · ' +
          ((await size(dir)) / 1048576).toFixed(1) +
          ' MiB' +
          (protectedVersion ? '（保留）' : ''),
      );
    }
  }
  return rows.join('\n') || '暂无版本缓存';
}

export async function serveDaemon(directory: string, agentId: string, version: string) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');

  let binding = Promise.resolve();
  const sockets = new Set<Socket>();
  let stopping = false;
  const stop = () => {
    stopping = true;
    server.close();
    for (const socket of sockets) socket.destroy();
  };
  const host = new AgentHost(directory, agentId, version, stop);
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
      if (value === 'idle?' || value === 'stop!') {
        const activity = host.activity();
        if (value === 'idle?' && (activity.terminals.length || activity.tasks.length)) {
          socket.end(
            [
              ...activity.terminals.map((t) => '终端 ' + t.repositoryName + ' (' + t.id + ')'),
              ...activity.tasks.map((t) => '任务 ' + t.method + ' (' + t.id + ')'),
            ].join('\n'),
          );
          return;
        }
        stopping = true;
        for (const peer of sockets) if (peer !== socket) peer.destroy();

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
          await host.connect(
            () => new SocketTransport(socket),
            gitProxyPort,
            () => !socket.destroyed && !stopping,
          );
          socket.resume();
        })
        .catch(() => {
          socket.destroy();
        });
    };
    socket.on('readable', authenticate);
  });

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
    await host.close();
  } finally {
    process.off('SIGTERM', stop).off('SIGINT', stop);
    if (readRuntime()?.token === token) fs.unlinkSync(runtime);
  }
}
