import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventPublisher } from '../ports/handler';
import { ProtocolError, validateEmpty, type TaskInfo } from '@alune/protocol';
import type { ProxyPort } from '@alune/agent-client/node';
import type { MessageTransport } from '@alune/agent-client';
import { openStateKernel } from '../bootstrap/state-kernel';
import { ClientConnection } from './session';

export class AgentHost {
  private kernel?: Awaited<ReturnType<typeof openStateKernel>>;
  private connections = new Set<ClientConnection>();
  private proxy = new AsyncLocalStorage<{ port: ProxyPort }>();
  readonly sequence = { value: 0 };
  private readonly interrupted = new Map<string, TaskInfo>();
  private readonly tasks = new Map<
    AbortController,
    { session: string; info: TaskInfo; done: Promise<void> }
  >();
  private timer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    private directory: string,
    private agentId: string,
    private version: string,
    private onIdle: () => void,
    private idleMs = 30 * 60_000,
  ) {
    this.updateIdle();
  }

  private updateIdle() {
    clearTimeout(this.timer);
    if (
      !this.stopping &&
      !this.connections.size &&
      !this.tasks.size &&
      !this.kernel?.hasActiveTerminals()
    )
      this.timer = setTimeout(this.onIdle, this.idleMs).unref();
  }

  async connect(transport: () => MessageTransport, port: ProxyPort, alive: () => boolean) {
    const proxy = this.proxy;
    this.kernel ??= await openStateKernel(
      this.directory,
      this.agentId,
      undefined,
      {},
      {
        activityChanged: () => this.updateIdle(),
        get gitProxyPort() {
          return proxy.getStore()?.port;
        },
      },
    );
    if (!alive()) return;
    const route = { port };
    const kernel = this.kernel;
    const current = new ClientConnection(transport(), {
      agentId: this.agentId,
      version: this.version,
      sshSnapshotChannel: true,
      handlers: {
        ...Object.fromEntries(
          Object.entries(kernel.handlers).map(([name, handler]) => [
            name,
            {
              ...handler,
              run: (...args: Parameters<typeof handler.run>) =>
                proxy.run(route, () => handler.run(...args)),
            },
          ]),
        ),
        'tasks.reconcile': {
          effect: 'query',
          validate: validateEmpty,
          run: () => Array.from(this.interrupted.values(), (info) => ({ ...info })),
        },
      },
      taskJournal: kernel.taskJournal,
      host: this,
      onDispose: async () => {
        if (route.port) route.port = 'blocked';
        for (const { info, session } of this.tasks.values())
          if (session === current.sessionId) this.remember(info);
        kernel.disconnect(current.sessionId);
      },
    });
    this.connections.add(current);
    this.updateIdle();
    void current.closed.then(() => {
      this.connections.delete(current);
      this.updateIdle();
    });
  }

  notifyState(...args: Parameters<EventPublisher['notifyState']>) {
    for (const client of this.connections) client.events.notifyState(...args);
  }
  broadcast(...args: Parameters<EventPublisher['write']>) {
    for (const {events} of this.connections) {
      if (events.subscribed(args[0])) void events.write(...args).catch(error => events.failStream(error));
    }
  }
  activity() {
    const active = new Map<string, string>();
    for (const client of this.connections)
      for (const task of client.runningTasks()) active.set(task.taskId, task.method);
    for (const { info } of this.tasks.values()) active.set(info.taskId, info.method);
    return {
      terminals: this.kernel?.activeTerminals() ?? [],
      tasks: [...active].map(([id, method]) => ({ id, method })),
    };
  }
  private remember(info: TaskInfo) {
    this.interrupted.set(info.taskId, info);
    if (this.interrupted.size > 1024)
      this.interrupted.delete(this.interrupted.keys().next().value!);
  }
  checkTaskCapacity() {
    if (this.tasks.size >= 64) throw new ProtocolError('overloaded', 'Too many running tasks');
  }
  start(controller: AbortController, info: TaskInfo, session: string) {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.tasks.set(controller, { info, done, session });
    return () => {
      for (const { events } of this.connections)
        if (this.interrupted.has(info.taskId) && events?.subscribed('tasks.reconciled'))
          void events
            .write('tasks.reconciled', { ...info })
            .catch((error) => events.failStream(error));
      this.tasks.delete(controller);
      finish();
      this.updateIdle();
    };
  }
  async close() {
    this.stopping = true;
    clearTimeout(this.timer);
    for (const task of this.tasks.keys()) task.abort();
    await Promise.all([...this.connections].map((client) => client.close()));
    await Promise.all(Array.from(this.tasks.values(), (task) => task.done));
    await this.kernel?.close();
  }
}
