import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { connect as tcp, type Socket } from 'node:net';
import { Client, type ClientChannel } from 'ssh2';
import { ProtocolError, type OpenHostRoute } from '@alune/protocol';
import { StdioTransport } from '@alune/agent-client/node';
import { SSHChannelQueue } from './channel-queue';
import { bootstrapCommands, unixProbe, windowsProbe, targetFrom } from './commands';
import { readBundle } from './bundles';
import {
  connectProxySocket,
  createProxyBridge,
  type ProxySnapshot,
} from '../network/proxy-transport';
import type { HostProfilesStore } from '../../modules/accounts/hosts';

export async function connectHost(
  directory: string,
  profile: ReturnType<HostProfilesStore['credential']>,
  policy: OpenHostRoute,
  proxy: ProxySnapshot,
  signal: AbortSignal,
  priorDigest?: string,
  stage?: (phase: string) => void,
) {
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
  const command = async (cmd: string, input?: Buffer): Promise<string> => {
    const ch = await open(cmd);
    return new Promise((resolve, reject) => {
      let output = '',
        code: number | undefined;
      ch.on('data', (b: Buffer) => {
        output += b.toString();
        if (output.length > 8192) {
          ch.close();
          reject(new Error('SSH probe output limit'));
        }
      });
      ch.stderr.resume();
      ch.on('error', reject);
      ch.once('exit', (n: number) => {
        code = n;
      });
      ch.once('close', (n?: number) =>
        (code ?? n) === 0 ? resolve(output) : reject(new Error('SSH bootstrap command failed')),
      );
      ch.end(input);
    });
  };
  signal.throwIfAborted();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const keyPath = profile.privateKeyPath?.replace(/^~[/\\]/, homedir() + '/');
    const privateKey =
      profile.authType === 'privateKey'
        ? await readFile(keyPath ?? join(homedir(), '.ssh', 'id_rsa'))
        : undefined;
    sock = await connectProxySocket(proxy, profile.host, profile.port, signal);
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      ssh
        .once('ready', resolve)
        .once('error', reject)
        .once('close', () => reject(lost));
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
        hostVerifier: (key: string) => key === policy.hostKey,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
      });
    });
    stage?.('probing');
    let detected = targetFrom(await command(unixProbe).catch(() => ''));
    if (!detected.target) detected = targetFrom(await command(windowsProbe).catch(() => ''));
    const bundle = await readBundle(directory, detected.target);
    if (priorDigest && priorDigest !== bundle.sha256 && !policy.install)
      throw new ProtocolError(
        'incompatible-version',
        'A different SSH bundle requires explicit upgrade',
      );
    let forwardPort: number | undefined;
    if (proxy.enabled) {
      stage?.('forwarding');
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
        socket
          .on('error', () => stream.destroy())
          .once('close', () => {
            sockets.delete(socket);
            stream.destroy();
          });
        stream.on('error', () => socket.destroy()).once('close', () => socket.destroy());
        stream.pipe(socket).pipe(stream);
      });
      forwardPort = await new Promise<number>((resolve, reject) =>
        ssh.forwardIn('127.0.0.1', 0, (err, port) => (err ? reject(err) : resolve(port))),
      );
    }
    const commands = bootstrapCommands(
      detected.target === 'win32-x64',
      bundle.sha256,
      randomUUID(),
      forwardPort,
    );
    stage?.(policy.install ? 'installing' : 'verifying');
    if (policy.install) await command(commands.upload, await bundle.bytes());
    else if ((await command(commands.installed)) !== 'present')
      throw new ProtocolError(
        'unavailable',
        'SSH bundle is not installed; explicitly install it first',
      );
    try {
      await command(commands.prepare);
      signal.throwIfAborted();
      stage?.('starting');
      channel = await open(commands.serve);
    } catch (error) {
      if (!closed) await command(commands.clean).catch(() => {});
      throw error;
    }
    channel.stderr.resume();
    const transport = new StdioTransport(channel, channel);
    transport.onClose(close);
    return { transport, close, version: bundle.version, digest: bundle.sha256, ...detected };
  } catch (error) {
    close();
    sock?.destroy();
    bridge?.close();
    signal.throwIfAborted();
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(
      'unavailable',
      'SSH authentication, forwarding or verified Agent deployment failed',
    );
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
