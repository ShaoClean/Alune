import { StateFault } from '../ports/state';
import { stateFailure } from './errors';
import { randomUUID } from 'node:crypto';
import {
  CORE_CAPABILITIES,
  PROTOCOL_VERSION,
  ProtocolError,
  validateInitialize,
  validateEmpty,
  isRecord,
  validId,
  validateTaskQuery,
  requestSequence,
  MAX_FRAME_BYTES,
  MAX_STREAM_CHUNK_BYTES,
  compatibleError,
} from '@alune/protocol';
import type { JsonValue, RpcMessage, RpcRequest, TaskInfo } from '@alune/protocol';
import type { MessageTransport } from '@alune/agent-client';
import type { Handler } from '../ports/handler';
import { EventQueue } from '../runtime/events';
import type { TaskJournal } from '../ports/task-journal';

export interface SessionOptions {
  host?: import('./host').AgentHost;
  agentId: string;
  version: string;
  sshSnapshotChannel?: boolean;
  handlers?: Readonly<Record<string, Handler>>;
  taskJournal?: TaskJournal;
  onDispose?: () => Promise<void>;
  shutdownMs?: number;
  eventLimits?: { bytes: number; messages: number; ackMs: number };
}
export class ClientConnection {
  readonly sessionId = randomUUID();
  readonly events: EventQueue;
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private lifecycle = new AbortController();
  private initialized = false;
  private protocolMinor = 0;
  private closing?: Promise<void>;
  private requestPrefix?: string;
  private lastRequestSequence = 0;
  private lastSnapshotSequence = 0;
  private activeRequests = 0;
  private requestBytes = 0;
  private tasks = new Map<
    string,
    { info: TaskInfo; controller: AbortController; journaled: boolean }
  >();
  private running = new Map<Promise<void>, string | undefined>();
  private capabilities: string[];
  private disposers: Array<() => void> = [];
  shutdownTimedOut = false;
  shutdownFailed = false;
  failure?: Error;
  constructor(
    private transport: MessageTransport,
    private options: SessionOptions,
  ) {
    if (!validId(options.agentId)) throw new Error('Invalid Agent identity');
    const custom = Object.keys(options.handlers ?? {});
    if (
      custom.some(
        (method) =>
          method === 'initialize' ||
          (CORE_CAPABILITIES as readonly string[]).includes(method) ||
          !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(method),
      )
    )
      throw new Error('Reserved or invalid handler name');
    this.capabilities = [...CORE_CAPABILITIES, ...custom];
    for (const name of custom) {
      const minor = options.handlers![name].minimumProtocolMinor;
      if (minor !== undefined && (!Number.isSafeInteger(minor) || minor < 0))
        throw new Error('Invalid handler protocol minor requirement');
    }
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.events = new EventQueue(
      options.agentId,
      this.sessionId,
      (message) => transport.send(message),
      (error) => {
        void this.close(error);
      },
      options.eventLimits,
      options.host?.sequence,
    );
    this.disposers.push(
      transport.onMessage((message) => {
        if (this.closing) return;
        const operation = this.handle(message).catch((error) => {
          void this.close(error);
        });
        this.running.set(operation, 'id' in message ? (message.id ?? undefined) : undefined);
        void operation.finally(() => this.running.delete(operation));
      }),
      transport.onClose((error) => {
        void this.close(error);
      }),
    );
  }
  private async handle(message: RpcMessage): Promise<void> {
    if (!('method' in message))
      throw new ProtocolError('invalid-request', 'Agent only accepts requests/notifications');
    if (!('id' in message)) {
      if (!this.initialized) throw new ProtocolError('not-initialized', 'Initialize first');
      if (message.method === '$/cancelRequest') {
        if (!isRecord(message.params) || !validId(message.params.requestId))
          throw new ProtocolError('invalid-params', 'Invalid cancellation');
        const task = this.tasks.get(message.params.requestId);
        if (task?.info.state === 'running') task.controller.abort();
      } else if (message.method === 'events.ack') {
        if (
          !isRecord(message.params) ||
          message.params.sessionId !== this.sessionId ||
          !Number.isSafeInteger(message.params.sequence) ||
          Number(message.params.sequence) < 1
        )
          throw new ProtocolError('invalid-params', 'Invalid acknowledgement');
        this.events.ack(Number(message.params.sequence));
      } else throw new ProtocolError('unknown-method', 'Unknown notification');
      return;
    }
    const sequence = requestSequence(message.id);
    // Only the leaf permits the broker's independent, read-only snapshot stream.
    const snapshot =
      this.options.sshSnapshotChannel &&
      sequence?.prefix === 'ssh-read' &&
      message.method === 'repositories.hostRead';
    if (!sequence || (!snapshot && this.requestPrefix && this.requestPrefix !== sequence.prefix))
      throw new ProtocolError('invalid-request', 'Request ID prefix changed within the session');
    if (sequence.sequence <= (snapshot ? this.lastSnapshotSequence : this.lastRequestSequence)) {
      // Never let a duplicate ID resolve a still-running request with a second result.
      await this.transport.send({
        jsonrpc: '2.0',
        id: null,
        error: new ProtocolError(
          'duplicate-request',
          'Request ID reused; close this session',
          'unknown',
        ).toRpcError(),
      });
      void this.close();
      return;
    }
    if (snapshot) this.lastSnapshotSequence = sequence.sequence;
    else {
      this.requestPrefix = sequence.prefix;
      this.lastRequestSequence = sequence.sequence;
    }
    const bytes = Buffer.byteLength(JSON.stringify(message));
    const control =
      message.method === 'initialize' ||
      (CORE_CAPABILITIES as readonly string[]).includes(message.method);
    if (
      this.activeRequests >= (control ? 72 : 64) ||
      this.requestBytes + bytes > MAX_FRAME_BYTES + (control ? MAX_STREAM_CHUNK_BYTES : 0)
    ) {
      // Do not retain an oversized request while its small rejection waits to drain.
      void this.transport
        .send({
          jsonrpc: '2.0',
          id: message.id,
          error: new ProtocolError('overloaded', 'In-flight request budget exceeded').toRpcError(),
        })
        .catch((error) => {
          void this.close(error);
        });
      return;
    }
    this.activeRequests++;
    this.requestBytes += bytes;
    let task: TaskInfo | undefined;
    let journalActive = false;
    let finishBackground: (() => void) | undefined;
    try {
      if (message.method === 'initialize') {
        if (this.initialized)
          throw new ProtocolError('invalid-request', 'Session already initialized');
        const requested = validateInitialize(message.params);
        this.protocolMinor = Math.min(requested.protocol.minor, PROTOCOL_VERSION.minor);
        this.capabilities = [
          ...CORE_CAPABILITIES,
          ...Object.keys(this.options.handlers ?? {}).filter(
            (name) =>
              (this.options.handlers![name].minimumProtocolMinor ?? 0) <= this.protocolMinor,
          ),
        ];
        this.initialized = true;
        await this.result(message, {
          protocol: { major: PROTOCOL_VERSION.major, minor: this.protocolMinor },
          agentId: this.options.agentId,
          sessionId: this.sessionId,
          implementation: { name: 'alune-agent', version: this.options.version },
          capabilities: this.capabilities,
          lifecycle: 'session',
        });
        return;
      }
      if (!this.initialized) throw new ProtocolError('not-initialized', 'Initialize first');
      if (['agent.health', 'agent.version', 'agent.capabilities'].includes(message.method)) {
        validateEmpty(message.params);
        const result: JsonValue =
          message.method === 'agent.health'
            ? {
                status: 'ok',
                agentId: this.options.agentId,
                sessionId: this.sessionId,
                lifecycle: 'session',
              }
            : message.method === 'agent.version'
              ? { version: this.options.version, protocol: { ...PROTOCOL_VERSION } }
              : { capabilities: this.capabilities };
        await this.result(message, result);
        return;
      }
      if (message.method === 'events.subscribe') {
        const p = message.params;
        if (
          !isRecord(p) ||
          !Array.isArray(p.topics) ||
          p.topics.length > 128 ||
          !p.topics.every(
            (topic) => typeof topic === 'string' && topic.length > 0 && topic.length <= 128,
          )
        )
          throw new ProtocolError('invalid-params', 'Invalid subscription topics');
        this.events.subscribe(p.topics as string[]);
        await this.result(message, { subscribed: p.topics as string[], sessionId: this.sessionId });
        return;
      }
      if (message.method === 'requests.cancel' || message.method === 'events.ack') {
        await this.handle({
          jsonrpc: '2.0',
          method: message.method === 'requests.cancel' ? '$/cancelRequest' : 'events.ack',
          ...(message.params === undefined ? {} : { params: message.params }),
        });
        await this.result(message, { accepted: true });
        return;
      }
      if (message.method === 'tasks.get') {
        const p = validateTaskQuery(message.params);
        const found = validId(p.requestId)
          ? this.tasks.get(p.requestId)
          : [...this.tasks.values()].find((entry) => entry.info.taskId === p.taskId);
        // A failed durable finalization can leave a running receipt on disk.
        // The current session still knows that execution ended with unknown
        // durability; do not hide that state behind the older stored snapshot.
        const stored = !found && this.protocolMinor >= 1 ? this.options.taskJournal?.find(p) : null;
        await this.result(message, {
          scope:
            stored || (found?.journaled && this.protocolMinor >= 1 && this.options.taskJournal)
              ? 'agent'
              : 'session',
          task: found ? { ...found.info } : stored ? { ...stored } : null,
        });
        return;
      }
      const handler = Object.hasOwn(this.options.handlers ?? {}, message.method)
        ? this.options.handlers?.[message.method]
        : undefined;
      if (!handler || !this.capabilities.includes(message.method))
        throw new ProtocolError('unknown-method', 'Unknown method');
      if ([...this.tasks.values()].filter((entry) => entry.info.state === 'running').length >= 64)
        throw new ProtocolError('overloaded', 'Too many running tasks');
      const validation: unknown = handler.validate(message.params);
      if (
        validation &&
        (typeof validation === 'object' || typeof validation === 'function') &&
        typeof (validation as { then?: unknown }).then === 'function'
      ) {
        void Promise.resolve(validation).catch(() => {});
        throw new ProtocolError('internal', 'Handler validation must be synchronous');
      }
      const operationId = handler.operationId?.(message.params);
      if (operationId) {
        if (!this.options.taskJournal)
          throw new ProtocolError(
            'unavailable',
            'A durable journal is required for this operation',
          );
      }
      const controller = new AbortController();
      const admitted: TaskInfo = {
        taskId: operationId ?? randomUUID(),
        requestId: message.id,
        method: message.method,
        effect: handler.effect,
        state: 'running',
        outcome: 'unknown',
        startedAt: Date.now(),
      };
      if (handler.effect === 'mutation' && handler.durable !== false && this.options.taskJournal) {
        this.options.host?.checkTaskCapacity();
        this.options.taskJournal.start(admitted, operationId);
        journalActive = true;
        finishBackground = this.options.host?.start(controller, admitted);
      }
      task = admitted;
      this.tasks.set(message.id, { info: task, controller, journaled: journalActive });
      this.taskEvent(task);
      const value = await handler.run(message.params, {
        agentId: this.options.agentId,
        sessionId: this.sessionId,
        sessionSignal: finishBackground ? controller.signal : this.lifecycle.signal,
        taskId: task.taskId,
        signal: controller.signal,
        events: finishBackground
          ? {
              subscribed: (type) => !this.closing && this.events.subscribed(type),
              notifyState: (...args) => this.options.host?.events?.notifyState(...args),
              failStream: (error) => this.events.failStream(error),
              write: async (...args) => {
                if (this.closing) return;
                try {
                  await this.events.write(...args);
                } catch (error) {
                  if (!this.closing) throw error;
                }
              },
            }
          : this.events,
      });
      task.state = 'succeeded';
      task.outcome = 'completed';
      task.finishedAt = Date.now();
      if (journalActive) {
        journalActive = false;
        this.options.taskJournal!.finish(task);
      }
      this.taskEvent(task);
      this.pruneTasks();
      if (!this.closing)
        await this.result(message, value).catch((error) => {
          void this.close(error);
        });
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      let failure =
        error instanceof ProtocolError
          ? error
          : error instanceof StateFault
            ? stateFailure(error)
            : new ProtocolError(
                cancelled ? 'cancelled' : 'internal',
                cancelled ? 'Task cancelled' : 'Internal Agent error',
                task ? (task.effect === 'mutation' ? 'unknown' : 'completed') : 'not-started',
              );
      if (task) {
        task.state =
          failure.outcome === 'unknown'
            ? 'unknown'
            : failure.kind === 'cancelled'
              ? 'cancelled'
              : 'failed';
        task.outcome = failure.outcome;
        task.finishedAt = Date.now();
        if (journalActive) {
          journalActive = false;
          try {
            this.options.taskJournal!.finish(task);
          } catch {
            task.state = 'unknown';
            task.outcome = 'unknown';
            failure = new ProtocolError(
              'unavailable',
              'Task receipt could not be finalized; query the task and current state',
              'unknown',
            );
          }
        }
        this.taskEvent(task);
        this.pruneTasks();
      }
      if (!this.closing) await this.error(message, failure);
    } finally {
      finishBackground?.();
      this.activeRequests--;
      this.requestBytes -= bytes;
    }
  }
  private taskEvent(task: TaskInfo): void {
    (this.options.host?.events ?? this.events).notifyState('tasks.changed', { ...task });
  }
  private pruneTasks(): void {
    for (const [id, task] of this.tasks) {
      if (this.tasks.size <= 1024) break;
      if (task.info.state !== 'running') this.tasks.delete(id);
    }
  }
  private result(request: RpcRequest, result: JsonValue): Promise<void> {
    return this.transport.send({ jsonrpc: '2.0', id: request.id, result });
  }
  private error(request: RpcRequest, error: ProtocolError): Promise<void> {
    return this.transport.send({
      jsonrpc: '2.0',
      id: request.id,
      error: compatibleError(error.toRpcError(), this.protocolMinor),
    });
  }
  close(
    error: Error = new ProtocolError('disconnected', 'Agent session ended', 'unknown'),
  ): Promise<void> {
    if (this.closing) return this.closing;
    this.failure = error;
    // Publish the complete shutdown promise before abort/transport callbacks can
    // re-enter close(). A resolved sentinel lets those callers outlive cleanup.
    this.closing = Promise.resolve().then(async () => {
      for (const dispose of this.disposers) dispose();
      this.lifecycle.abort();
      this.events.close(error);
      for (const task of this.tasks.values())
        if (task.info.state === 'running' && !(this.options.host && task.journaled))
          task.controller.abort();
      this.transport.close(error);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([
            ...Array.from(this.running)
              .filter(([, id]) => !(this.options.host && id && this.tasks.get(id)?.journaled))
              .map(([work]) => work),
            Promise.resolve()
              .then(() => this.options.onDispose?.())
              .catch(() => {
                this.shutdownFailed = true;
              }),
          ]),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              this.shutdownTimedOut = true;
              resolve();
            }, this.options.shutdownMs ?? 3000);
          }),
        ]);
        for (const task of this.tasks.values())
          if (task.info.state === 'running' && !(this.options.host && task.journaled))
            task.info.state = 'unknown';
      } finally {
        clearTimeout(timer);
        this.resolveClosed();
      }
    });
    return this.closing;
  }
}

export { ClientConnection as AgentSession };
