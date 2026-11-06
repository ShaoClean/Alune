import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { MAX_FRAME_BYTES, isRecord } from '@alune/protocol';
import { frameTransport, type FrameChannel } from './frame-channel';
import { AgentClient } from './client';

export type HostRole = 'workspace' | 'logs' | 'native';
export async function launchUiAgent(
  command: string,
  entry: string,
  directory: string,
  catalogPath?: string,
) {
  const env = { ...process.env };
  for (const key of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'ELECTRON_RUN_AS_NODE',
    'ALUNE_AGENT_RELEASE_CATALOG',
  ])
    delete env[key];
  if (catalogPath) env.ALUNE_AGENT_RELEASE_CATALOG = catalogPath;
  const child = spawn(
    command,
    ['--max-semi-space-size=2', entry, 'serve-ui', '--data-dir', directory],
    {
      env,
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      // Frames are already encoded JSON strings. Structured IPC transports
      // those strings without escaping and parsing the whole frame again.
      serialization: 'advanced',
      windowsHide: true,
      shell: false,
    },
  );
  const channels = new Map<string, EventEmitter>();
  let ended = false;
  let closing: Promise<void> | undefined;
  let ready!: () => void, fail!: (err: Error) => void;
  const started = new Promise<void>((resolve, reject) => {
    ready = resolve;
    fail = reject;
  });
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('close', () => resolve());
  });
  function end() {
    if (ended) return;
    ended = true;
    fail(new Error('Agent process stopped before initialization'));
    for (const channel of channels.values()) channel.emit('end');
    channels.clear();
  }
  child.on('error', (error) => {
    fail(error);
    end();
  });
  child.once('disconnect', end);
  child.once('close', end);
  child.on('message', (packet) => {
    if (!isRecord(packet)) return;
    if (packet.kind === 'ready') return ready();
    if (typeof packet.id !== 'string') return;
    const ch = channels.get(packet.id);
    if (packet.kind === 'frame' && typeof packet.frame === 'string')
      ch?.emit('frame', packet.frame);
    if (packet.kind === 'end') {
      channels.delete(packet.id);
      ch?.emit('end');
    }
  });
  let queuedBytes = 0,
    queuedMessages = 0;
  const send = (packet: Record<string, string>) =>
    new Promise<void>((resolve, reject) => {
      if (ended || !child.connected) return reject(new Error('Agent process disconnected'));
      const bytes = Buffer.byteLength(packet.frame ?? '');
      if (queuedMessages >= 256 || queuedBytes + bytes > MAX_FRAME_BYTES * 2)
        return reject(new Error('Agent IPC backlog exceeded'));
      queuedBytes += bytes;
      queuedMessages++;
      const done = (error?: Error | null) => {
        queuedBytes -= bytes;
        queuedMessages--;
        if (error) reject(error);
        else resolve();
      };
      try {
        child.send(packet, done);
      } catch (error) {
        done(error as Error);
      }
    });
  function close() {
    return (closing ??= (async () => {
      if (child.connected) child.disconnect();
      const timer = setTimeout(
        () => child.kill('SIGKILL'),
        process.platform === 'win32' ? 16000 : 6000,
      );
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    })());
  }
  const timer = setTimeout(() => fail(new Error('Agent startup timed out')), 30000);
  try {
    await started;
  } catch (error) {
    await close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return {
    close,
    pid: child.pid!,
    exited,
    async open(role: HostRole): Promise<FrameChannel> {
      if (closing || ended || channels.size >= 16) throw new Error('Agent session unavailable');
      const id = randomUUID(),
        channel = new EventEmitter();
      channels.set(id, channel);
      try {
        await send({ kind: 'open', id, role });
      } catch (error) {
        channels.delete(id);
        throw error;
      }
      if (!channels.has(id)) throw new Error('Agent session closed');
      return {
        send(frame) {
          if (
            !channels.has(id) ||
            typeof frame !== 'string' ||
            Buffer.byteLength(frame) > MAX_FRAME_BYTES
          )
            return Promise.reject(new Error('Invalid or closed Agent channel'));
          return send({ kind: 'frame', id, frame });
        },
        close() {
          if (channels.delete(id)) void send({ kind: 'end', id }).catch(() => {});
        },
        onEnd(fn) {
          channel.on('end', fn);
          return () => {
            channel.off('end', fn);
          };
        },
        onFrame(fn) {
          channel.on('frame', fn);
          return () => {
            channel.off('frame', fn);
          };
        },
      };
    },
  };
}

// The independent process may die while the desktop window or Vite remains
// alive. Reopen only on a fresh channel request. Never replay an RPC.
export async function superviseUiAgent(
  command: string,
  entry: string,
  directory: string,
  version: string,
  catalogPath?: string,
) {
  let current: Awaited<ReturnType<typeof launchUiAgent>> | undefined,
    control: AgentClient | undefined;
  let opening: Promise<void> | undefined,
    stopped = false,
    owner: string | undefined;
  function ready(): Promise<void> {
    if (stopped) return Promise.reject(new Error('Agent host is closing'));
    if (control?.state === 'ready') return Promise.resolve();
    return (opening ??= (async () => {
      await current?.close();
      const host = await launchUiAgent(command, entry, directory, catalogPath);
      try {
        const client = new AgentClient(frameTransport(await host.open('native')));
        const identity = await client.initialize({ name: 'alune-host', version });
        if (
          stopped ||
          identity.implementation.version !== version ||
          (owner && owner !== identity.agentId)
        )
          throw new Error('Agent identity or version changed; check the data directory');
        owner = identity.agentId;
        current = host;
        control = client;
      } catch (error) {
        await host.close();
        throw error;
      }
    })().finally(() => {
      opening = undefined;
    }));
  }
  await ready();
  return {
    get client() {
      return control!;
    },
    get pid() {
      return current!.pid;
    },
    async open(role: HostRole) {
      await ready();
      return current!.open(role);
    },
    async close() {
      stopped = true;
      await opening?.catch(() => {});
      control?.close();
      await current?.close();
    },
  };
}
