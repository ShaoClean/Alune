import {
  ProtocolError,
  isRecord,
  parseMessage,
  validId,
  validateOpenHost,
  type JsonValue,
  type OpenHostRoute,
  type RpcMessage,
} from '@alune/protocol';
import { AgentClient, type RequestOptions } from './client';
import type { MessageTransport } from './transport';

/** A browser-safe logical stdio stream. Forward original request IDs, cancellation,
 * terminal ACKs and errors to one SSH session; never replace it on disconnect. */
class HostTransport implements MessageTransport {
  private messages = new Set<(m: RpcMessage) => void>();
  private closures = new Set<(e: Error) => void>();
  private stop = new AbortController();
  constructor(
    private local: AgentClient,
    private routeId: string,
  ) {}
  onMessage(fn: (m: RpcMessage) => void) {
    this.messages.add(fn);
    return () => this.messages.delete(fn);
  }
  onClose(fn: (e: Error) => void) {
    this.closures.add(fn);
    return () => this.closures.delete(fn);
  }
  async send(message: RpcMessage) {
    await this.local.request(
      'hosts.send',
      { routeId: this.routeId, message: message as unknown as JsonValue },
      { signal: this.stop.signal },
    );
  }
  async read() {
    try {
      while (!this.stop.signal.aborted) {
        const frame = await this.local.request(
          'hosts.receive',
          { routeId: this.routeId },
          { timeoutMs: 30000, signal: this.stop.signal },
        );
        if (frame === null) continue;
        const message = parseMessage(JSON.stringify(frame));
        for (const f of this.messages) f(message);
      }
    } catch (e) {
      this.close(e as Error);
    }
  }
  close(error: Error = new ProtocolError('disconnected', 'SSH route closed', 'unknown')) {
    if (this.stop.signal.aborted) return;
    this.stop.abort();
    for (const f of this.closures) f(error);
    this.messages.clear();
    this.closures.clear();
    void this.local
      .request('hosts.disconnect', { routeId: this.routeId }, { timeoutMs: 5000 })
      .catch(() => {});
  }
}
export async function openRemoteAgent(
  local: AgentClient,
  policy: OpenHostRoute,
  options: RequestOptions = {},
) {
  validateOpenHost(policy);
  const result = await local.request('hosts.open', policy as unknown as JsonValue, {
    timeoutMs: null,
    ...options,
  });
  if (!isRecord(result) || !validId(result.routeId))
    throw new ProtocolError('invalid-request', 'Invalid host route');
  const wire = new HostTransport(local, result.routeId);
  const client = new AgentClient(wire);
  const abort = () => wire.close(new ProtocolError('cancelled', 'SSH route opening cancelled'));
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    void wire.read();
    await client.initialize();
    await client.listRepositories(options); // atomically replace only this owner's stale snapshot
    return client;
  } catch (e) {
    client.close();
    throw e;
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}
export async function openLegacyRepository(
  local: AgentClient,
  remote: AgentClient,
  hostId: string,
  resourceId: string,
) {
  const source = await local.request('hosts.legacyPath', { hostId, resourceId });
  if (
    !isRecord(source) ||
    typeof source.path !== 'string' ||
    source.agentId !== remote.initialized?.agentId
  )
    throw new ProtocolError('conflict', 'Legacy host does not match the selected Agent');
  const repo = await remote.registerRepository(source.path);
  await remote.listRepositories();
  await local.request('hosts.bindRepository', { resource: { ...repo.resource } });
  return repo;
}
