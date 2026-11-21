import { validTerminalId } from '@alune/protocol';
export { validTerminalId } from '@alune/protocol';
import { TERMINAL_LIMITS, type TerminalOutput, type TerminalSession } from '@alune/domain';
import { TerminalRegistry } from './registry';
import type { TerminalCallbacks, TerminalTransport } from '../../ports/terminal';
export interface TerminalTarget {
  repositoryName: string;
  initialPath: string;
  windowsPty?: TerminalSession['windowsPty'];
  source: 'local' | 'ssh';
  connectionId?: string;
  environment: string;
  open(
    cols: number,
    rows: number,
    signal: AbortSignal,
    callbacks: TerminalCallbacks,
  ): Promise<TerminalTransport>;
}
export interface TerminalOwner {
  readonly protocolSession?: true;
  id: string;
  connected: boolean;
  fail?(error: Error): void;
  emit(event: string, payload: unknown): unknown;
}
interface Delivery {
  info: TerminalSession;
  owner: TerminalOwner;
  pending: string[];
  pendingBytes: number;
  inFlight?: number;
  sequence: number;
  ackTimer?: NodeJS.Timeout;
}
interface Session extends Delivery {
  viewers: Map<string, Delivery>;
  controller: AbortController;
  transport?: TerminalTransport;
  starting?: Promise<void>;
  stopping?: Promise<void>;
  history: string[];
  historyBytes: number;
  startTimer?: NodeJS.Timeout;
  inputBudget: number;
  inputAt: number;
  finished: boolean;
}
const dimensions = (cols: unknown, rows: unknown) => {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    Number(cols) < 2 ||
    Number(cols) > 500 ||
    Number(rows) < 1 ||
    Number(rows) > 200
  )
    throw new Error('终端尺寸必须在 2–500 列、1–200 行内。');
};
export class TerminalSessions {
  private starts = new Set<Promise<void>>();
  private sessions = new Map<string, Session>();
  private disposals = new Set<Promise<void>>();
  constructor(
    private target: (id: string, owner: TerminalOwner) => Promise<TerminalTarget>,
    private registry: TerminalRegistry,
    readonly persistent = false,
    private activityChanged = () => {},
  ) {}

  create(owner: TerminalOwner, body: any): TerminalSession {
    if (!this.registry.enabled) throw new Error('终端仅在已认证的 Alune 服务中可用。');
    if (!owner.connected) throw new Error('终端连接已断开。');
    if (!validTerminalId(body?.requestId) || !validTerminalId(body?.repositoryId))
      throw new Error('请选择有效仓库并重新创建终端。');
    dimensions(body.cols, body.rows);
    this.registry.assertAvailable(body.repositoryId);
    if (this.sessions.has(body.requestId)) throw new Error('终端创建请求不能重复。');
    if (
      [...this.sessions.values()].filter((entry) => this.persistent || entry.owner.id === owner.id)
        .length >= TERMINAL_LIMITS.sessions
    )
      throw new Error('每个窗口最多保留 8 个终端，请先关闭不需要的会话。');
    const info: TerminalSession = {
      id: body.requestId,
      requestId: body.requestId,
      repositoryId: body.repositoryId,
      repositoryName: '',
      source: 'local',
      environment: '',
      initialPath: '',
      state: 'connecting',
      cols: body.cols,
      rows: body.rows,
      createdAt: Date.now(),
    };
    const entry: Session = {
      info,
      owner,
      controller: new AbortController(),
      viewers: new Map(),
      history: [],
      historyBytes: 0,
      pending: [],
      pendingBytes: 0,
      sequence: 0,
      inputBudget: 64 * 1024,
      inputAt: Date.now(),
      finished: false,
    };
    this.sessions.set(info.id, entry);
    this.registry.entries.set(info.id, {
      info,
      close: () => this.remove(entry),
    });
    this.activityChanged();
    entry.startTimer = setTimeout(() => this.finish(entry, 'failed', '终端启动超时。'), 35_000);
    const start = this.start(entry, body.cols, body.rows);
    entry.starting = start;
    this.starts.add(start);
    void start.finally(() => this.starts.delete(start));
    return { ...info };
  }

  private async start(entry: Session, cols: number, rows: number) {
    const signal = entry.controller.signal;
    try {
      const { open, ...target } = await this.target(entry.info.repositoryId, entry.owner);
      this.registry.assertAvailable(entry.info.repositoryId);
      Object.assign(entry.info, target);
      signal.throwIfAborted();
      this.state(entry);
      const callbacks = {
        data: (data: string) => this.output(entry, data),
        exit: (code?: number, signal?: number | string) => {
          entry.info.exitCode = code;
          entry.info.signal = signal;
          this.finish(entry, 'exited');
        },
        disconnect: (message: string) => this.finish(entry, 'disconnected', message),
      };
      const transport = await open(cols, rows, signal, callbacks);
      if (
        signal.aborted ||
        (!this.persistent && !entry.owner.connected) ||
        this.sessions.get(entry.info.id) !== entry
      ) {
        await this.dispose(transport);
        return;
      }
      entry.transport = transport;
      clearTimeout(entry.startTimer);
      entry.info.state = 'running';
      this.state(entry);
      this.pump(entry);
      if (entry.pendingBytes >= TERMINAL_LIMITS.windowBytes) transport.pause();
      else transport.resume();
    } catch (error) {
      if (!signal.aborted)
        this.finish(entry, 'failed', error instanceof Error ? error.message : '终端启动失败。');
    }
  }

  private state(entry: Session) {
    if (this.sessions.get(entry.info.id) !== entry) return;
    const publisher = entry.owner.connected ? entry.owner : entry.viewers.values().next().value?.owner;
    publisher?.emit('terminal:state', { ...entry.info });
  }

  private output(entry: Session, data: string) {
    if (entry.finished || !data || this.sessions.get(entry.info.id) !== entry) return;
    if (
      entry.owner.connected &&
      entry.pendingBytes + Buffer.byteLength(data) > TERMINAL_LIMITS.pendingBytes
    ) {
      if (this.persistent && entry.owner.fail) {
        entry.owner.fail(new Error('Terminal output delivery interrupted'));
        this.disconnect(entry.owner);
      } else {
        entry.pending = [];
        entry.pendingBytes = 0;
        this.finish(entry, 'disconnected', '终端输出超过传输上限，已停止会话；部分输出未送达。');
        return;
      }
    }
    // Keep UTF-16 surrogate pairs together; each packet is <= 16 KiB in UTF-8.
    for (let index = 0; index < data.length; ) {
      let end = Math.min(index + 4096, data.length);
      if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
      const chunk = data.slice(index, end);
      const bytes = Buffer.byteLength(chunk);
      if (this.persistent) {
        const last = entry.history.length - 1;
        if (last >= 0 && entry.history[last].length + chunk.length <= 4096)
          entry.history[last] += chunk;
        else entry.history.push(chunk);
        entry.historyBytes += bytes;
        while (entry.historyBytes > 128 * 1024)
          entry.historyBytes -= Buffer.byteLength(entry.history.shift()!);
      }
      if (entry.owner.connected) {
        entry.pending.push(chunk);
        entry.pendingBytes += bytes;
      }
      for (const viewer of entry.viewers.values()) {
        viewer.pending.push(chunk);
        viewer.pendingBytes += bytes;
        if (viewer.pendingBytes > TERMINAL_LIMITS.pendingBytes) {
          viewer.owner.fail?.(new Error('Terminal viewer output delivery interrupted'));
          this.disconnect(viewer.owner);
        }
      }
      index = end;
    }
    if (entry.pendingBytes >= TERMINAL_LIMITS.windowBytes) entry.transport?.pause();
    this.pump(entry);
    for (const viewer of entry.viewers.values()) this.pump(viewer);
  }

  private pump(entry: Delivery) {
    if (entry.inFlight !== undefined || !entry.owner.connected) return;
    let data: string = entry.pending.shift() ?? '';
    if (!data) return;
    // node-pty often delivers several tiny adjacent chunks. Send one bounded
    // packet per parser ACK, without delaying the first interactive character.
    for (let i = 0; entry.owner.protocolSession && i < 8 && entry.pending.length; i++) {
      const next = entry.pending[0];
      if (Buffer.byteLength(data) + Buffer.byteLength(next) > TERMINAL_LIMITS.packetBytes) break;
      const combined = data + next;
      if (Buffer.byteLength(JSON.stringify(combined)) > 48 * 1024) break;
      data = combined;
      entry.pending.shift();
    }
    entry.pendingBytes -= Buffer.byteLength(data);
    const sequence = ++entry.sequence;
    entry.inFlight = sequence;
    entry.ackTimer = setTimeout(() => {
      if (this.persistent && entry.owner.fail) {
        entry.owner.fail(new Error('Terminal output delivery interrupted'));
        this.disconnect(entry.owner);
      } else {
        entry.pending = [];
        entry.pendingBytes = 0;
        const session = this.sessions.get(entry.info.id);
        if (session)
          this.finish(session, 'disconnected', '终端输出确认超时，已停止会话；请显式新建。');
      }
    }, 30_000);
    const packet: TerminalOutput = { sessionId: entry.info.id, sequence, data };
    entry.owner.emit('terminal:output', packet);
  }

  ack(owner: TerminalOwner, body: any) {
    const session = this.sessions.get(body?.sessionId);
    const entry = session?.viewers.get(owner.id) ?? this.owned(owner, body?.sessionId);
    if (entry.inFlight === undefined || body?.sequence !== entry.inFlight)
      throw new Error('无效的终端输出确认。');
    clearTimeout(entry.ackTimer);
    entry.inFlight = undefined;
    this.pump(entry);
    if (session === entry && entry.pendingBytes < TERMINAL_LIMITS.windowBytes / 2)
      session.transport?.resume();
  }

  input(owner: TerminalOwner, body: any) {
    const entry = this.owned(owner, body?.sessionId, true);
    if (
      typeof body.data !== 'string' ||
      !body.data.length ||
      Buffer.byteLength(body.data) > TERMINAL_LIMITS.inputBytes
    )
      throw new Error('单次终端输入不能超过 16 KiB。');
    const now = Date.now();
    entry.inputBudget = Math.min(64 * 1024, entry.inputBudget + (now - entry.inputAt) * 32);
    entry.inputAt = now;
    const size = Buffer.byteLength(body.data);
    if (entry.inputBudget < size) throw new Error('终端输入过快，请稍后重试。');
    entry.inputBudget -= size;
    entry.transport!.write(body.data);
  }

  resize(owner: TerminalOwner, body: any) {
    const entry = this.owned(owner, body?.sessionId, true);
    dimensions(body.cols, body.rows);
    entry.transport!.resize(body.cols, body.rows);
    Object.assign(entry.info, { cols: body.cols, rows: body.rows });
  }

  close(owner: TerminalOwner, body: any) {
    const entry = this.owned(owner, body?.sessionId);
    if (entry.info.state === 'running' && body.confirmed !== true)
      throw new Error('请先确认关闭正在运行的终端。');
    return this.remove(entry);
  }

  list(owner: TerminalOwner) {
    return [...this.sessions.values()]
      .filter((e) => (this.persistent ? !e.finished : e.owner.id === owner.id))
      .map((e) => ({ ...e.info }));
  }
  attach(owner: TerminalOwner, id: string) {
    const entry = this.sessions.get(id);
    if (!this.persistent || !entry || entry.finished || !owner.connected)
      throw new Error('远端终端已结束。');
    if (entry.owner.connected && entry.owner.id !== owner.id) {
      if (!entry.viewers.has(owner.id)) {
        const viewer = {
          info: entry.info,
          owner,
          sequence: 0,
          pending: [...entry.history],
          pendingBytes: entry.historyBytes,
        };
        entry.viewers.set(owner.id, viewer);
        this.pump(viewer);
      }
      return { ...entry.info, readOnly: true };
    }
    clearTimeout(entry.viewers.get(owner.id)?.ackTimer);
    entry.viewers.delete(owner.id);
    clearTimeout(entry.ackTimer);
    entry.inFlight = undefined;
    entry.owner = owner;
    entry.pending = [...entry.history];
    entry.pendingBytes = entry.historyBytes;
    this.pump(entry);
    if (entry.pendingBytes < TERMINAL_LIMITS.windowBytes) entry.transport?.resume();
    else entry.transport?.pause();
    return { ...entry.info };
  }
  private owned(owner: TerminalOwner, id: unknown, running = false) {
    const entry = typeof id === 'string' ? this.sessions.get(id) : undefined;
    if (entry?.viewers.has(owner.id)) throw new Error('当前窗口只读，输入与尺寸由控制窗口管理。');
    if (!entry || entry.owner.id !== owner.id || !owner.connected)
      throw new Error('终端不存在或不属于当前窗口。');
    if (running && (entry.info.state !== 'running' || !entry.transport))
      throw new Error('此终端已停止接收输入，请显式新建会话。');
    return entry;
  }

  private finish(entry: Session, state: TerminalSession['state'], error?: string) {
    if (entry.finished || this.sessions.get(entry.info.id) !== entry) return;
    entry.finished = true;
    clearTimeout(entry.startTimer);
    entry.controller.abort();
    if (entry.transport) entry.stopping = this.dispose(entry.transport);
    entry.transport = undefined;
    Object.assign(entry.info, { state, error });
    this.state(entry);
    if (this.persistent && !entry.owner.connected) void this.remove(entry);
    this.activityChanged();
  }

  private remove(entry: Session) {
    entry.finished = true;
    const publisher = entry.owner.connected ? entry.owner : entry.viewers.values().next().value?.owner;
    for (const viewer of entry.viewers.values()) clearTimeout(viewer.ackTimer);
    entry.viewers.clear();
    this.sessions.delete(entry.info.id);
    this.registry.entries.delete(entry.info.id);
    this.activityChanged();
    clearTimeout(entry.startTimer);
    clearTimeout(entry.ackTimer);
    entry.controller.abort();
    if (entry.transport) entry.stopping = this.dispose(entry.transport);
    entry.pending = [];
    entry.pendingBytes = 0;
    publisher?.emit('terminal:removed', { sessionId: entry.info.id });
    return Promise.all([entry.starting, entry.stopping]).then(() => {});
  }

  disconnect(owner: Pick<TerminalOwner, 'id'> & Partial<TerminalOwner>) {
    for (const entry of this.sessions.values()) {
      clearTimeout(entry.viewers.get(owner.id)?.ackTimer);
      entry.viewers.delete(owner.id);
      if (entry.owner.id !== owner.id) continue;
      if (!this.persistent || entry.finished) {
        void this.remove(entry);
        continue;
      }
      clearTimeout(entry.ackTimer);
      entry.inFlight = undefined;
      entry.owner = { id: '', connected: false, emit() {} };
      entry.pending = [];
      entry.pendingBytes = 0;
      entry.transport?.resume();
    }
  }
  private dispose(transport: TerminalTransport) {
    const promise = transport.dispose();
    if (promise) {
      this.disposals.add(promise);
      void promise.then(
        () => this.disposals.delete(promise),
        () => this.disposals.delete(promise),
      );
      return promise;
    }
  }
  async onModuleDestroy() {
    for (const entry of this.sessions.values()) this.remove(entry);
    await Promise.all(this.starts);
    await Promise.all(this.disposals);
  }
}
