import { validTerminalId } from '@alune/protocol';
export { validTerminalId } from '@alune/protocol';
import { TERMINAL_LIMITS, type TerminalOutput, type TerminalSession } from '@alune/domain';
import { TerminalRegistry } from './registry';
import type { TerminalCallbacks, TerminalTransport } from '../../ports/terminal';
export interface TerminalTarget {
  repositoryName: string;
  initialPath: string;
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
  emit(event: string, payload: unknown): unknown;
}
interface Session {
  info: TerminalSession;
  owner: TerminalOwner;
  controller: AbortController;
  transport?: TerminalTransport;
  pending: string[];
  pendingBytes: number;
  inFlight?: number;
  sequence: number;
  ackTimer?: NodeJS.Timeout;
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
      [...this.sessions.values()].filter((entry) => entry.owner.id === owner.id).length >=
      TERMINAL_LIMITS.sessions
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
      createdAt: Date.now(),
    };
    const entry: Session = {
      info,
      owner,
      controller: new AbortController(),
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
    entry.startTimer = setTimeout(() => this.finish(entry, 'failed', '终端启动超时。'), 35_000);
    const start = this.start(entry, body.cols, body.rows);
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
      if (signal.aborted || !entry.owner.connected || this.sessions.get(entry.info.id) !== entry) {
        this.dispose(transport);
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
    if (this.sessions.get(entry.info.id) === entry && entry.owner.connected)
      entry.owner.emit('terminal:state', { ...entry.info });
  }

  private output(entry: Session, data: string) {
    if (entry.finished || !data || this.sessions.get(entry.info.id) !== entry) return;
    if (entry.pendingBytes + Buffer.byteLength(data) > TERMINAL_LIMITS.pendingBytes) {
      entry.pending = [];
      entry.pendingBytes = 0;
      this.finish(entry, 'disconnected', '终端输出超过传输上限，已停止会话；部分输出未送达。');
      return;
    }
    // Keep UTF-16 surrogate pairs together; each packet is <= 16 KiB in UTF-8.
    for (let index = 0; index < data.length; ) {
      let end = Math.min(index + 4096, data.length);
      if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
      const chunk = data.slice(index, end);
      entry.pending.push(chunk);
      entry.pendingBytes += Buffer.byteLength(chunk);
      index = end;
    }
    if (entry.pendingBytes >= TERMINAL_LIMITS.windowBytes) entry.transport?.pause();
    this.pump(entry);
  }

  private pump(entry: Session) {
    if (entry.inFlight !== undefined || !entry.owner.connected) return;
    const data = entry.pending.shift();
    if (!data) return;
    entry.pendingBytes -= Buffer.byteLength(data);
    const sequence = ++entry.sequence;
    entry.inFlight = sequence;
    entry.ackTimer = setTimeout(() => {
      entry.pending = [];
      entry.pendingBytes = 0;
      this.finish(entry, 'disconnected', '终端输出确认超时，已停止会话；请显式新建。');
    }, 30_000);
    const packet: TerminalOutput = { sessionId: entry.info.id, sequence, data };
    entry.owner.emit('terminal:output', packet);
  }

  ack(owner: TerminalOwner, body: any) {
    const entry = this.owned(owner, body?.sessionId);
    if (entry.inFlight === undefined || body?.sequence !== entry.inFlight)
      throw new Error('无效的终端输出确认。');
    clearTimeout(entry.ackTimer);
    entry.inFlight = undefined;
    this.pump(entry);
    if (entry.pendingBytes < TERMINAL_LIMITS.windowBytes / 2) entry.transport?.resume();
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
  }

  close(owner: TerminalOwner, body: any) {
    const entry = this.owned(owner, body?.sessionId);
    if (entry.info.state === 'running' && body.confirmed !== true)
      throw new Error('请先确认关闭正在运行的终端。');
    this.remove(entry);
  }

  list(owner: TerminalOwner) {
    return [...this.sessions.values()]
      .filter((e) => e.owner.id === owner.id)
      .map((e) => ({ ...e.info }));
  }
  private owned(owner: TerminalOwner, id: unknown, running = false) {
    const entry = typeof id === 'string' ? this.sessions.get(id) : undefined;
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
    if (entry.transport) this.dispose(entry.transport);
    entry.transport = undefined;
    Object.assign(entry.info, { state, error });
    this.state(entry);
  }

  private remove(entry: Session) {
    entry.finished = true;
    this.sessions.delete(entry.info.id);
    this.registry.entries.delete(entry.info.id);
    clearTimeout(entry.startTimer);
    clearTimeout(entry.ackTimer);
    entry.controller.abort();
    if (entry.transport) this.dispose(entry.transport);
    entry.pending = [];
    entry.pendingBytes = 0;
    if (entry.owner.connected) entry.owner.emit('terminal:removed', { sessionId: entry.info.id });
  }

  disconnect(owner: TerminalOwner) {
    for (const entry of this.sessions.values()) if (entry.owner.id === owner.id) this.remove(entry);
  }
  private dispose(transport: TerminalTransport) {
    const promise = transport.dispose();
    if (promise) {
      this.disposals.add(promise);
      void promise.finally(() => this.disposals.delete(promise));
    }
  }
  async onModuleDestroy() {
    for (const entry of this.sessions.values()) this.remove(entry);
    await Promise.all(this.starts);
    await Promise.all(this.disposals);
  }
}
