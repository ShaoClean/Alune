import { randomUUID } from 'node:crypto';
import { TerminalService, TerminalOwner } from './terminal.service';
import { TerminalRegistry } from './terminal-registry';
import {
  localTerminal,
  TerminalCallbacks,
  TerminalTransport,
} from './terminal-transport';

jest.mock('./terminal-transport', () => ({
  localTerminal: jest.fn(),
  sshTerminal: jest.fn(),
}));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
describe('terminal session ownership and lifecycle', () => {
  let registry: TerminalRegistry;
  let service: TerminalService;
  let transport: TerminalTransport;
  let callbacks: TerminalCallbacks;
  let owner: TerminalOwner;
  let repo: { id: string; source: string; name: string; path: string };
  const spawn = jest.mocked(localTerminal);
  beforeEach(() => {
    registry = new TerminalRegistry();
    registry.enabled = true;
    repo = {
      id: randomUUID(),
      source: 'local',
      name: 'repo',
      path: '/registered/path',
    };
    transport = {
      write: jest.fn(),
      resize: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dispose: jest.fn(),
    };
    spawn.mockImplementation(async (_path, _cols, _rows, _signal, handler) => {
      callbacks = handler;
      return transport;
    });
    service = new TerminalService(
      { get: jest.fn(async () => repo) } as any,
      {} as any,
      registry,
    );
    owner = { id: 'window-a', connected: true, emit: jest.fn() };
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllMocks();
  });
  const start = (
    service: TerminalService,
    owner: TerminalOwner,
    repositoryId: string,
  ) =>
    service.create(owner, {
      requestId: randomUUID(),
      repositoryId,
      cols: 80,
      rows: 24,
      path: '/attacker/path',
    });

  it('binds the registered path and never trusts client cwd; all mutations require the owner', async () => {
    const session = start(service, owner, repo.id);
    await tick();
    expect(spawn.mock.calls[0][0]).toBe(repo.path);
    const other = { ...owner, id: 'window-b' };
    for (const operation of [
      () => service.input(other, { sessionId: session.id, data: 'x' }),
      () =>
        service.resize(other, { sessionId: session.id, cols: 90, rows: 30 }),
      () => service.ack(other, { sessionId: session.id, sequence: 1 }),
      () => service.close(other, { sessionId: session.id, confirmed: true }),
    ])
      expect(operation).toThrow('不属于当前窗口');
    service.input(owner, { sessionId: session.id, data: '\x03' });
    expect(transport.write).toHaveBeenCalledWith('\x03');
  });

  it('disposes a late spawn after cancellation instead of resurrecting a shell', async () => {
    const pending = deferred<TerminalTransport>();
    spawn.mockImplementationOnce(() => pending.promise);
    const session = start(service, owner, repo.id);
    await tick();
    service.close(owner, { sessionId: session.id });
    pending.resolve(transport);
    await tick();
    expect(transport.dispose).toHaveBeenCalledTimes(1);
    expect(registry.entries.size).toBe(0);
    expect(
      (owner.emit as jest.Mock).mock.calls.some(
        ([, payload]) => payload.state === 'running',
      ),
    ).toBe(false);
  });

  it('counts pending and ended sessions toward the per-window limit', async () => {
    for (let index = 0; index < 8; index++) start(service, owner, repo.id);
    expect(() => start(service, owner, repo.id)).toThrow('最多保留 8');
    await tick();
    callbacks.exit(0);
    expect(() => start(service, owner, repo.id)).toThrow('最多保留 8');
    const first = [...registry.entries.keys()][0];
    service.close(owner, { sessionId: first, confirmed: true });
    expect(() => start(service, owner, repo.id)).not.toThrow();
  });

  it('pauses output, accepts only exact acknowledgements and aborts before unbounded buffering', async () => {
    const session = start(service, owner, repo.id);
    await tick();
    callbacks.data('x'.repeat(96 * 1024));
    expect(transport.pause).toHaveBeenCalled();
    const output = (owner.emit as jest.Mock).mock.calls.filter(
      ([event]) => event === 'terminal:output',
    );
    expect(output).toHaveLength(1);
    expect(Buffer.byteLength(output[0][1].data)).toBeLessThanOrEqual(16 * 1024);
    expect(() =>
      service.ack(owner, { sessionId: session.id, sequence: 99 }),
    ).toThrow();
    service.ack(owner, { sessionId: session.id, sequence: 1 });
    expect(
      (owner.emit as jest.Mock).mock.calls.filter(
        ([event]) => event === 'terminal:output',
      ),
    ).toHaveLength(2);
    callbacks.data('x'.repeat(256 * 1024));
    expect(registry.entries.get(session.id)?.info.state).toBe('disconnected');
    expect(registry.entries.get(session.id)?.info.error).toContain(
      '部分输出未送达',
    );
    expect(transport.dispose).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh deletion confirmation when another window creates a session', async () => {
    const first = start(service, owner, repo.id);
    const other = { ...owner, id: 'window-b' };
    const second = start(service, other, repo.id);
    expect(() =>
      registry.remove({ repositoryId: repo.id }, [first.id]),
    ).toThrow();
    expect(registry.entries.size).toBe(2);
    await tick();
    registry.remove({ repositoryId: repo.id }, [first.id, second.id]);
    expect(registry.entries.size).toBe(0);
  });

  it('disconnect releases only the affected window without touching another shell', async () => {
    const first = start(service, owner, repo.id);
    const second = start(service, { ...owner, id: 'window-b' }, repo.id);
    await tick();
    service.disconnect(owner);
    expect(registry.entries.has(first.id)).toBe(false);
    expect(registry.entries.has(second.id)).toBe(true);
  });
});
