import { ProtocolError, validateEmpty, type TaskInfo } from '@alune/protocol';
import type { ProxyPort } from '@alune/agent-client/node';
import type { MessageTransport } from '@alune/agent-client';
import { openStateKernel } from '../bootstrap/state-kernel';
import { ClientConnection } from './session';

export class AgentHost {
  private kernel?: Awaited<ReturnType<typeof openStateKernel>>;
  private connection?: ClientConnection;
  readonly sequence = { value: 0 };
  private readonly interrupted = new Map<string, TaskInfo>();
  private readonly tasks = new Map<AbortController, { info: TaskInfo; done: Promise<void> }>();
  private readonly remote = {
    gitProxyPort: undefined as ProxyPort,
    activityChanged: () => this.updateIdle(),
  };
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
      !this.connection &&
      !this.tasks.size &&
      !this.kernel?.hasActiveTerminals()
    )
      this.timer = setTimeout(this.onIdle, this.idleMs).unref();
  }

  async connect(transport: () => MessageTransport, port: ProxyPort, alive: () => boolean) {
    await this.connection?.close();
    this.kernel ??= await openStateKernel(this.directory, this.agentId, undefined, {}, this.remote);
    if (!alive()) return;
    this.remote.gitProxyPort = port;
    const kernel = this.kernel;
    const current = new ClientConnection(transport(), {
      agentId: this.agentId,
      version: this.version,
      sshSnapshotChannel: true,
      handlers: {
        ...kernel.handlers,
        'tasks.reconcile': {
          effect: 'query',
          validate: validateEmpty,
          run: () => Array.from(this.interrupted.values(), (info) => ({ ...info })),
        },
      },
      taskJournal: kernel.taskJournal,
      host: this,
      onDispose: async () => {
        for (const { info } of this.tasks.values()) this.remember(info);
        kernel.disconnect(current.sessionId);
      },
    });
    this.connection = current;
    this.updateIdle();
    void current.closed.then(() => {
      if (this.connection !== current) return;
      this.connection = undefined;
      if (this.remote.gitProxyPort) this.remote.gitProxyPort = 'blocked';
      this.updateIdle();
    });
  }

  get events() {
    return this.connection?.events;
  }
  private remember(info: TaskInfo) {
    this.interrupted.set(info.taskId, info);
    if (this.interrupted.size > 1024)
      this.interrupted.delete(this.interrupted.keys().next().value!);
  }
  checkTaskCapacity() {
    if (this.tasks.size >= 64) throw new ProtocolError('overloaded', 'Too many running tasks');
  }
  start(controller: AbortController, info: TaskInfo) {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.tasks.set(controller, { info, done });
    return () => {
      const events = this.events;
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
    await this.connection?.close();
    await Promise.all(Array.from(this.tasks.values(), (task) => task.done));
    await this.kernel?.close();
  }
}
