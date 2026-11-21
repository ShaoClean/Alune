import {
  ProtocolError,
  validateTerminalCommand,
  isRecord,
  validateInitialized,
  validateRepositoryResource,
  parseEvent,
  PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  type InitializeResult,
  type JsonValue,
  type RpcMessage,
  type RpcRequest,
  type RpcNotification,
  type RepositoryResource,
} from '@alune/protocol';
import type { MessageTransport } from '@alune/agent-client';

const disconnected = () =>
  new ProtocolError(
    'disconnected',
    'Remote Agent disconnected; reconcile outstanding writes',
    'unknown',
  );
// Forward the original RPC ids and event ACKs so a durable task can be queried on
// its actual owner after reconnect. A relay never retries or synthesizes a result.
export class HostRelay {
  private queue: { message: RpcMessage; bytes: number }[] = [];
  private bytes = 0;
  private waiting?: () => void;
  private failure?: Error;
  private pending = new Map<string, string>();
  // Track shells before dispatch: a dropped creation response is not proof there is no PTY.
  private shells = new Map<string, { repositoryId: string; requestId: string }>();
  private shellCreates = new Map<string, string>();
  get terminalImpact() {
    return [...this.shells.values()];
  }
  get pendingWrites() {
    return [...this.pending]
      .filter(([, method]) =>
        ['repositories.write', 'files.write', 'reviews.create', 'reviews.mutate'].includes(method),
      )
      .map(([requestId, method]) => ({ requestId, method }));
  }
  get activeTasks() {
    return (
      this.reads.size +
      [...this.pending.values()].filter(
        (m) => !['events.ack', 'repositories.operation', 'agent.health'].includes(m),
      ).length
    );
  }
  private identity?: InitializeResult;
  private lastList?: string;
  private readSequence = 0;
  private reads = new Map<
    string,
    { resolve: (value: JsonValue) => void; reject: (e: Error) => void }
  >();
  async snapshot(
    request: import('./snapshot').SnapshotRequest,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    signal.throwIfAborted();
    if (this.failure || !this.identity?.capabilities.includes('repositories.hostRead'))
      throw new ProtocolError('unavailable', 'Remote repository snapshot unavailable');
    if (this.reads.size >= 16) throw new ProtocolError('overloaded', 'Snapshot read limit reached');
    const id = 'ssh-read:' + ++this.readSequence;
    return new Promise((resolve, reject) => {
      const finish = () => {
        this.reads.delete(id);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        finish();
        void this.wire
          .send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { requestId: id } })
          .catch(() => {});
        reject(signal.reason);
      };
      this.reads.set(id, {
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: (e) => {
          finish();
          reject(e);
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      void this.wire
        .send({
          jsonrpc: '2.0',
          method: 'repositories.hostRead',
          id,
          params: request as unknown as JsonValue,
        })
        .catch((e) => this.reads.get(id)?.reject(e));
    });
  }
  constructor(
    private wire: MessageTransport,
    private version: string,
    private onIdentity: (identity: InitializeResult) => void,
    private onList: (rows: RepositoryResource[]) => void,
    private onEnd: (error: Error) => void,
    private onCatalogChange: () => void,
  ) {
    wire.onClose((e) => this.close(e));
    wire.onMessage((m) => {
      try {
        this.receive(m);
      } catch (e) {
        this.close(e as Error);
      }
    });
  }
  async send(m: RpcRequest | RpcNotification) {
    if (this.failure) throw this.failure;
    if (!this.identity && (m.method !== 'initialize' || !('id' in m) || this.pending.size))
      throw new ProtocolError('not-initialized', 'Initialize the remote Agent first');
    if (
      this.identity &&
      (m.method === 'initialize' ||
        (m.method !== '$/cancelRequest' && !this.identity.capabilities.includes(m.method)))
    )
      throw new ProtocolError('unknown-method', 'Remote capability unavailable');
    if ('id' in m) {
      if (m.id.startsWith('ssh-read:'))
        throw new ProtocolError('invalid-request', 'Reserved SSH snapshot request ID');
      if (this.pending.has(m.id) || this.pending.size >= 128)
        throw new ProtocolError('overloaded', 'Remote request limit exceeded');
      if (m.method === 'terminals.create') {
        const { requestId, resource } = validateTerminalCommand('create', m.params);
        if (!this.shells.has(requestId)) {
          if (this.shells.size >= 8)
            throw new ProtocolError('overloaded', 'Terminal session limit reached');
          this.shells.set(requestId, { requestId, repositoryId: resource.resourceId });
          this.shellCreates.set(m.id, requestId);
        }
      }
      this.pending.set(m.id, m.method);
      if (m.method === 'repositories.list') this.lastList = m.id;
    }
    try {
      await this.wire.send(m);
    } catch (e) {
      this.close(disconnected());
      throw this.failure;
    }
  }
  private receive(m: RpcMessage) {
    if (this.failure) return;
    if ('method' in m) {
      if ('id' in m || m.method !== 'agent.event') throw disconnected();
      const e = parseEvent(m.params);
      if (
        !this.identity ||
        e.agentId !== this.identity.agentId ||
        e.sessionId !== this.identity.sessionId
      )
        throw new ProtocolError('conflict', 'Remote event owner changed');
      if (
        e.type === 'terminal:removed' &&
        isRecord(e.payload) &&
        typeof e.payload.sessionId === 'string'
      )
        this.shells.delete(e.payload.sessionId);
      if (
        e.type === 'terminal:state' &&
        isRecord(e.payload) &&
        typeof e.payload.id === 'string' &&
        ['exited', 'disconnected', 'failed'].includes(String(e.payload.state))
      )
        this.shells.delete(e.payload.id);
    } else {
      if (m.id?.startsWith('ssh-read:')) {
        const read = this.reads.get(m.id);
        if (!read) return; // cancelled read: never deliver its late response to the other client
        if ('result' in m) read.resolve(m.result);
        else
          read.reject(new ProtocolError(m.error.data.kind, m.error.message, m.error.data.outcome));
        return;
      }
      const method = m.id && this.pending.get(m.id);
      if (!m.id || !method) throw disconnected();
      this.pending.delete(m.id);
      const creation = this.shellCreates.get(m.id);
      if (creation && 'error' in m && m.error.data.outcome !== 'unknown')
        this.shells.delete(creation);
      this.shellCreates.delete(m.id);
      if (
        [
          'repositories.register',
          'repositories.unregister',
          'repositories.pin',
          'repositories.openRelated',
          'repositories.write',
        ].includes(method)
      ) {
        this.lastList = undefined;
        this.onCatalogChange();
      }
      if (method === 'initialize' && 'result' in m) {
        const id = validateInitialized(m.result);
        if (
          id.implementation.name !== 'alune-agent' ||
          id.implementation.version !== this.version ||
          id.protocol.minor !== PROTOCOL_VERSION.minor ||
          id.capabilities.includes('hosts.open') ||
          ![
            'repositories.list',
            'repositories.write',
            'terminals.create',
            'reviews.list',
            'repositories.hostRead',
          ].every((c) => id.capabilities.includes(c))
        )
          throw new ProtocolError(
            'incompatible-version',
            `Expected alune-agent ${this.version} protocol ${PROTOCOL_VERSION.major}.${PROTOCOL_VERSION.minor} with remote capabilities; received ${id.implementation.name} ${id.implementation.version} protocol ${id.protocol.major}.${id.protocol.minor}`,
          );
        this.onIdentity(id);
        this.identity = id;
      }
      if (method === 'repositories.list' && 'result' in m && m.id === this.lastList) {
        if (!Array.isArray(m.result)) throw disconnected();
        const rows = m.result.map(validateRepositoryResource);
        if (
          rows.some((r) => r.resource.agentId !== this.identity?.agentId) ||
          new Set(rows.map((r) => r.id)).size !== rows.length
        )
          throw new ProtocolError('conflict', 'Invalid remote catalog ownership');
        this.onList(rows.filter((r) => r.source === 'local'));
      }
    }
    const bytes = Buffer.byteLength(JSON.stringify(m));
    if (
      this.queue.length >= 256 ||
      bytes + this.bytes > MAX_FRAME_BYTES * 2 ||
      bytes > MAX_FRAME_BYTES - 1024
    )
      throw new ProtocolError('overloaded', 'SSH relay receive budget exceeded', 'unknown');
    this.bytes += bytes;
    this.queue.push({ message: m, bytes });
    this.waiting?.();
  }
  async poll(signal: AbortSignal) {
    if (this.failure) throw this.failure;
    if (this.waiting) throw new ProtocolError('busy', 'A receive is already pending');
    signal.throwIfAborted();
    if (!this.queue.length)
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', wake);
          this.waiting = undefined;
          resolve();
        };
        const timer = setTimeout(wake, 15000);
        this.waiting = wake;
        signal.addEventListener('abort', wake, { once: true });
      });
    signal.throwIfAborted();
    if (this.failure) throw this.failure;
    const item = this.queue.shift();
    if (!item) return null;
    this.bytes -= item.bytes;
    return item.message;
  }
  close(error: Error = disconnected()) {
    if (this.failure) return;
    this.failure = error;
    for (const read of this.reads.values()) read.reject(error);
    this.pending.clear();
    this.queue = [];
    this.bytes = 0;
    this.waiting?.();
    this.wire.close(error);
    this.onEnd(error);
  }
}
