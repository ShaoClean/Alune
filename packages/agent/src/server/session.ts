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
} from '@alune/protocol';
import type { JsonValue, RpcMessage, RpcRequest, TaskInfo } from '@alune/protocol';
import type { MessageTransport } from '@alune/agent-client';
import type { Handler } from '../ports/handler';
import { EventQueue } from '../runtime/events';

export interface SessionOptions {
  agentId: string;
  version: string;
  handlers?: Readonly<Record<string, Handler>>;
  onDispose?: () => Promise<void>;
  shutdownMs?: number;
  eventLimits?: { bytes: number; messages: number; ackMs: number };
}
export class AgentSession {
  readonly sessionId = randomUUID();
  readonly events: EventQueue;
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private initialized = false;
  private closing?: Promise<void>;
  private seen = new Set<string>();
  private tasks = new Map<string, { info: TaskInfo; controller: AbortController }>();
  private running = new Set<Promise<void>>();
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
    );
    this.disposers.push(
      transport.onMessage((message) => {
        if (this.closing) return;
        const operation = this.handle(message).catch((error) => {
          void this.close(error);
        });
        this.running.add(operation);
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
    if (this.seen.has(message.id)) {
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
    if (this.seen.size >= 4096) {
      await this.error(
        message,
        new ProtocolError('overloaded', 'Session request quota reached; establish a new session'),
      );
      void this.close();
      return;
    }
    this.seen.add(message.id);
    let task: TaskInfo | undefined;
    try {
      if (message.method === 'initialize') {
        if (this.initialized)
          throw new ProtocolError('invalid-request', 'Session already initialized');
        validateInitialize(message.params);
        this.initialized = true;
        await this.result(message, {
          protocol: { ...PROTOCOL_VERSION },
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
        await this.result(message, { scope: 'session', task: found ? { ...found.info } : null });
        return;
      }
      const handler = Object.hasOwn(this.options.handlers ?? {}, message.method)
        ? this.options.handlers?.[message.method]
        : undefined;
      if (!handler) throw new ProtocolError('unknown-method', 'Unknown method');
      if ([...this.tasks.values()].filter((entry) => entry.info.state === 'running').length >= 64)
        throw new ProtocolError('overloaded', 'Too many running tasks');
      handler.validate(message.params);
      const controller = new AbortController();
      task = {
        taskId: randomUUID(),
        requestId: message.id,
        method: message.method,
        effect: handler.effect,
        state: 'running',
        outcome: 'unknown',
        startedAt: Date.now(),
      };
      this.tasks.set(message.id, { info: task, controller });
      this.taskEvent(task);
      const value = await handler.run(message.params, {
        agentId: this.options.agentId,
        sessionId: this.sessionId,
        taskId: task.taskId,
        signal: controller.signal,
        events: this.events,
      });
      task.state = 'succeeded';
      task.outcome = 'completed';
      task.finishedAt = Date.now();
      this.taskEvent(task);
      if (!this.closing) await this.result(message, value);
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      const failure =
        error instanceof ProtocolError
          ? error
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
        this.taskEvent(task);
      }
      if (!this.closing) await this.error(message, failure);
    }
  }
  private taskEvent(task: TaskInfo): void {
    this.events.notifyState('tasks.changed', { ...task });
  }
  private result(request: RpcRequest, result: JsonValue): Promise<void> {
    return this.transport.send({ jsonrpc: '2.0', id: request.id, result });
  }
  private error(request: RpcRequest, error: ProtocolError): Promise<void> {
    return this.transport.send({ jsonrpc: '2.0', id: request.id, error: error.toRpcError() });
  }
  close(
    error: Error = new ProtocolError('disconnected', 'Agent session ended', 'unknown'),
  ): Promise<void> {
    if (this.closing) return this.closing;
    // Set a sentinel before closing transport, whose onClose callback can re-enter.
    this.closing = Promise.resolve();
    this.failure = error;
    for (const dispose of this.disposers) dispose();
    this.events.close(error);
    for (const task of this.tasks.values())
      if (task.info.state === 'running') task.controller.abort();
    this.transport.close(error);
    this.closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([
            ...this.running,
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
          if (task.info.state === 'running') task.info.state = 'unknown';
      } finally {
        clearTimeout(timer);
        this.resolveClosed();
      }
    })();
    return this.closing;
  }
}
