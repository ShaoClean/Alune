import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { connect as tcp, type Socket } from 'node:net';
import { Client, type ClientChannel } from 'ssh2';
import { PROTOCOL_VERSION, ProtocolError, type OpenHostRoute } from '@alune/protocol';
import { StdioTransport } from '@alune/agent-client/node';
import { SSHChannelQueue } from './channel-queue';
import { runtimeCommands, unixProbe, windowsProbe, targetFrom } from './commands';
import { readBundle } from './bundles';
import {
  connectProxySocket,
  createProxyBridge,
  type ProxySnapshot,
} from '../network/proxy-transport';
import type { HostProfilesStore } from '../../modules/accounts/hosts';

type Profile = ReturnType<HostProfilesStore['credential']>;
async function authenticate(
  ssh: Client,
  profile: Profile,
  hostKey: string | null,
  proxy: ProxySnapshot,
  signal: AbortSignal,
) {
  const keyPath = profile.privateKeyPath?.replace(/^~[/\\]/, homedir() + '/');
  const privateKey =
    profile.authType === 'privateKey'
      ? await readFile(keyPath ?? join(homedir(), '.ssh', 'id_rsa'))
      : undefined;
  const sock = await connectProxySocket(proxy, profile.host, profile.port, signal);
  const abandon = () => {
    sock.destroy();
    ssh.destroy();
  };
  let verifiedHostKey = hostKey;
  let keyMismatch = false;
  signal.addEventListener('abort', abandon, { once: true });
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      ssh
        .once('ready', resolve)
        .once('error', reject)
        .once('close', () =>
          reject(new ProtocolError('disconnected', 'SSH authentication interrupted')),
        );
      ssh.connect({
        sock,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        privateKey,
        password: profile.password,
        passphrase: profile.passphrase,
        agent: profile.authType === 'sshAgent' ? process.env.SSH_AUTH_SOCK : undefined,
        hostHash: 'sha256',
        hostVerifier: (key: string) => {
          verifiedHostKey ??= key;
          keyMismatch = key !== verifiedHostKey;
          return !keyMismatch;
        },
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
      });
    });
    if (verifiedHostKey === null)
      throw new ProtocolError('permission-denied', '无法获取 SSH 主机公钥指纹。');
    return { socket: sock, hostKey: verifiedHostKey };
  } catch (error) {
    abandon();
    if (keyMismatch)
      throw new ProtocolError('permission-denied', '服务器提供的 SSH 主机公钥指纹与预期不一致。');
    throw error;
  } finally {
    signal.removeEventListener('abort', abandon);
  }
}

// Test the newly saved policy without disrupting an established SSH/PTY route.
export async function probeAuthentication(
  profile: Profile,
  key: string,
  proxy: ProxySnapshot,
  signal: AbortSignal,
) {
  const ssh = new Client();
  ssh.on('error', () => {});
  let socket: Socket | undefined;
  try {
    ({ socket } = await authenticate(ssh, profile, key, proxy, signal));
    signal.throwIfAborted();
  } finally {
    ssh.destroy();
    socket?.destroy();
  }
}
export async function connectHost(
  directory: string,
  profile: ReturnType<HostProfilesStore['credential']>,
  policy: OpenHostRoute,
  proxy: ProxySnapshot,
  signal: AbortSignal,
  stage?: (phase: string) => void,
) {
  let phase = 'authentication';
  const transition = (next: string) => {
    phase = next;
    stage?.(next);
  };
  const ssh = new Client(),
    queue = new SSHChannelQueue();
  const sockets = new Set<Socket>();
  let bridge: Awaited<ReturnType<typeof createProxyBridge>> | undefined;
  let sock: Socket | undefined,
    channel: ClientChannel | undefined,
    closed = false;
  const lost = new ProtocolError('disconnected', 'SSH Agent connection lost', 'unknown');
  const close = () => {
    if (closed) return;
    closed = true;
    queue.close(lost);
    channel?.destroy();
    ssh.destroy();
    sock?.destroy();
    bridge?.close();
    for (const s of sockets) s.destroy();
  };
  ssh.on('error', close).once('end', close).once('close', close);
  const abort = () => close();
  const open = (cmd: string): Promise<ClientChannel> =>
    new Promise((resolve, reject) =>
      queue.open<ClientChannel>(
        (cb) => ssh.exec(cmd, (err, ch) => cb(err ?? undefined, ch)),
        (ch) => ch.close(),
        (err, ch) => (err || !ch ? reject(err ?? lost) : resolve(ch)),
        signal,
      ),
    );
  const command = async (cmd: string, timeoutMs = 30_000, install = false): Promise<string> => {
    const ch = await open(cmd);
    return new Promise((resolve, reject) => {
      let output = '',
        stderr = '',
        code: number | undefined,
        settled = false;
      const finish = (err?: Error, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value ?? '');
      };
      const timer = setTimeout(() => {
        ch.close();
        finish(
          new ProtocolError(
            'timeout',
            `远端命令执行超时（${Math.round(timeoutMs / 1000)} 秒），阶段：${phase}`,
          ),
        );
      }, timeoutMs);
      ch.on('data', (b: Buffer) => {
        output += b.toString();
        if (install && output.trim() === 'ready' && !signal.aborted && !ch.writableEnded) {
          ch.end('publish\n');
        }
        if (output.length > 8192) {
          ch.close();
          finish(new Error('SSH probe output limit'));
        }
      });
      ch.stderr.on('data', (b: Buffer) => {
        if (phase === 'downloading' && b.toString().includes('ALUNE_VERIFY'))
          transition('verifying');
        if (stderr.length < 4096) {
          stderr += b.toString('utf8', 0, 4096 - stderr.length);
        }
      });
      ch.on('error', (err: Error) => finish(err));
      ch.once('exit', (n: number) => {
        code = n;
      });
      ch.once('close', (n?: number) => {
        if ((code ?? n) === 0) return finish(undefined, output);
        const detail = stderr.replace(/\s+/g, ' ').trim().slice(0, 240);
        finish(
          new Error(
            detail ? `SSH bootstrap command failed: ${detail}` : 'SSH bootstrap command failed',
          ),
        );
      });
      if (!install) ch.end();
    });
  };
  signal.throwIfAborted();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const authenticated = await authenticate(ssh, profile, policy.hostKey, proxy, signal);
    sock = authenticated.socket;
    transition('probing');
    let detected = targetFrom(await command(unixProbe, 20_000).catch(() => ''));
    if (!detected.target)
      detected = targetFrom(await command(windowsProbe, 20_000).catch(() => ''));
    const bundle = await readBundle(directory, detected.target);
    let forwardPort: number | undefined;
    if (proxy.enabled) {
      transition('forwarding');
      bridge = await createProxyBridge(() => proxy);
      signal.throwIfAborted();
      ssh.on('tcp connection', (info, accept, reject) => {
        if (
          closed ||
          info.destIP !== '127.0.0.1' ||
          info.destPort !== forwardPort ||
          !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(info.srcIP)
        )
          return reject();
        const socket = tcp(bridge!.port, '127.0.0.1');
        sockets.add(socket);
        const stream = accept();
        socket.on('error', () => stream.destroy()).once('close', () => sockets.delete(socket));
        stream.on('error', () => socket.destroy()).once('close', () => socket.destroy());
        stream.pipe(socket).pipe(stream);
      });
      forwardPort = await new Promise<number | undefined>((resolve, reject) => {
        const expired = () => {
          close();
          reject(new ProtocolError('timeout', 'SSH loopback forwarding timed out'));
        };
        const timer = setTimeout(expired, 15000);
        ssh.forwardIn('127.0.0.1', 0, (err, port) => {
          clearTimeout(timer);
          resolve(err ? undefined : port);
        });
      });
      signal.throwIfAborted();
      if (!forwardPort) {
        bridge.close();
        bridge = undefined;
      }
    }
    const commands = runtimeCommands(
      bundle,
      randomUUID(),
      forwardPort ?? (proxy.enabled ? 'blocked' : undefined),
    );
    let system: string | undefined;
    if (!policy.managedOnly) {
      const probe = await command(commands.probe).catch(() => '');
      const [path, ...lines] = probe.trim().split(/\r?\n/);
      try {
        const id = JSON.parse(lines.join('\n'));
        if (
          id.name === 'alune-agent' &&
          id.version === bundle.version &&
          id.protocol?.major === PROTOCOL_VERSION.major &&
          id.protocol.minor === PROTOCOL_VERSION.minor
        )
          system = path;
      } catch {
        /* Missing or incompatible system installation. */
      }
    }
    if (!system) {
      transition('verifying');
      if ((await command(commands.cache).catch(() => '')) !== 'present') {
        transition('downloading');
        await command(commands.install, 900_000, true);
      }
    }
    signal.throwIfAborted();
    transition('starting');
    channel = await open(commands.serve(system));
    channel.stderr.resume();
    const transport = new StdioTransport(channel, channel);
    transport.onClose(close);
    return {
      source: system ? 'system' : 'managed',
      transport,
      close,
      hostKey: authenticated.hostKey,
      version: bundle.version,
      digest: bundle.sha256,
      gitProxy: proxy.enabled ? (forwardPort ? 'ready' : 'blocked') : 'disabled',
      ...detected,
    };
  } catch (error) {
    close();
    sock?.destroy();
    bridge?.close();
    signal.throwIfAborted();
    if (error instanceof ProtocolError) throw error;
    const detail =
      error instanceof Error && error.message.startsWith('SSH bootstrap command failed: ')
        ? error.message.slice('SSH bootstrap command failed: '.length)
        : '';
    throw new ProtocolError(
      'unavailable',
      detail ? `SSH Agent ${phase} failed: ${detail}` : 'SSH Agent ' + phase + ' failed',
    );
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
