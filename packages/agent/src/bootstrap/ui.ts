// Only an inherited parent IPC descriptor can open these sessions. The parent
// selects the role; neither the renderer nor a network peer supplies a role.
import { EventEmitter } from 'node:events';
import { frameTransport } from '@alune/agent-client';
import { isRecord, validId, MAX_FRAME_BYTES } from '@alune/protocol';
import type { Handler } from '../ports/handler';
import { AgentSession } from '../server/session';
import type { openStateKernel } from './state-kernel';

type Kernel = Awaited<ReturnType<typeof openStateKernel>>;
const sharedEvents = new Set([
  'repositories.changed',
  'hosts.changed',
  'settings.changed',
  'accounts.hosts.changed',
  'accounts.tokens.changed',
  'diagnostics.logs.changed',
]);
const logs = new Set([
  'diagnostics.logs.snapshot',
  'diagnostics.logs.chunk',
  'diagnostics.logs.release',
]);
const native = new Set([
  'desktop.log',
  'network.updaterBridge',
  'diagnostics.logs.settings',
  'diagnostics.logs.client',
  'desktop.tasks.impact',
  'desktop.terminals.impact',
  'desktop.terminals.remove',
]);
export async function serveUi(kernel: Kernel, agentId: string, version: string) {
  if (!process.connected || !process.send) throw new Error('Private host channel is required');
  const sessions = new Map<
    string,
    { session: AgentSession; channel: EventEmitter; role: string }
  >();
  const send = (packet: Record<string, string>) =>
    new Promise<void>((resolve, reject) => {
      if (!process.connected) return reject(new Error('Host disconnected'));
      process.send!(packet, (error) => (error ? reject(error) : resolve()));
    });
  let stop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const receive = (packet: unknown) => {
    if (!isRecord(packet) || !validId(packet.id)) return;
    const id = packet.id,
      existing = sessions.get(id);
    if (packet.kind === 'end') {
      void existing?.session.close();
      return;
    }
    if (packet.kind === 'frame') {
      if (typeof packet.frame !== 'string' || Buffer.byteLength(packet.frame) > MAX_FRAME_BYTES)
        void existing?.session.close();
      else existing?.channel.emit('frame', packet.frame);
      return;
    }
    if (packet.kind !== 'open' || existing) return;
    const role = packet.role;
    if ((role !== 'logs' && role !== 'workspace' && role !== 'native') || sessions.size >= 16) {
      void send({ kind: 'end', id }).catch(stop);
      return;
    }
    const channel = new EventEmitter();
    const transport = frameTransport({
      send: (frame) => send({ kind: 'frame', id, frame }),
      close() {
        void send({ kind: 'end', id }).catch(() => {});
      },
      onFrame(fn) {
        channel.on('frame', fn);
        return () => {
          channel.off('frame', fn);
        };
      },
      onEnd() {
        return () => {};
      },
    });
    const handlers: Record<string, Handler> = {};
    for (const [name, h] of Object.entries<Handler>({
      ...kernel.handlers,
      ...kernel.desktopHandlers,
    })) {
      if (
        role === 'logs'
          ? !logs.has(name)
          : role === 'native'
            ? !native.has(name)
            : name.startsWith('desktop.') ||
              name.startsWith('storage.') ||
              name === 'network.updaterBridge'
      )
        continue;
      handlers[name] = {
        ...h,
        run(params, ctx) {
          return h.run(params, {
            ...ctx,
            ...(role === 'workspace' ? { workspaceRenderer: true as const } : {}),
            events: {
              subscribed: (t) => ctx.events.subscribed(t),
              failStream: (e) => ctx.events.failStream(e),
              write: (...args) => ctx.events.write(...args),
              notifyState(type, payload, resource) {
                if (!sharedEvents.has(type)) return ctx.events.notifyState(type, payload, resource);
                for (const peer of sessions.values()) {
                  if (
                    peer.role === 'workspace' ||
                    (peer.role === 'logs' && type === 'diagnostics.logs.changed')
                  )
                    peer.session.events.notifyState(type, payload, resource);
                }
              },
            },
          });
        },
      };
    }
    const session: AgentSession = new AgentSession(transport, {
      agentId,
      version,
      handlers,
      taskJournal: role === 'logs' ? undefined : kernel.taskJournal,
      shutdownMs: process.platform === 'win32' ? 12000 : 3000,
      onDispose: async () => kernel.disconnect(session.sessionId),
    });
    sessions.set(id, { session, channel, role });
    void session.closed.then(() => sessions.delete(id));
  };
  process.on('message', receive);
  process.once('disconnect', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await send({ kind: 'ready' });
    await stopped;
  } finally {
    process.off('message', receive);
    process.off('disconnect', stop);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    await Promise.all([...sessions.values()].map(({ session }) => session.close()));
    if (process.connected) process.disconnect();
  }
}
