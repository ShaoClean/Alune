import Database from 'better-sqlite3';
import { SSHConnection } from '@remote-git/ssh-client';
import { ConnectionService } from './connection.service';

describe('ConnectionService concurrent status reads', () => {
  let db: Database.Database;
  let service: ConnectionService;
  let events: { emitConnectionStatus: jest.Mock };
  const config = {
    name: 'Fixture',
    host: 'fixture.invalid',
    port: 22,
    username: 'fixture',
    authType: 'password' as const,
  };
  beforeEach(() => {
    db = new Database(':memory:');
    events = { emitConnectionStatus: jest.fn() };
    service = new ConnectionService(db, events as any);
  });
  afterEach(() => {
    service.onModuleDestroy();
    db.close();
    jest.restoreAllMocks();
  });

  it('shares a pending connection for repositories on one host', async () => {
    let ready!: () => void;
    const connect = jest
      .spyOn(SSHConnection.prototype, 'connect')
      .mockImplementation(
        () =>
          new Promise<void>((done) => {
            ready = done;
          }),
      );
    const created = await service.create(config);
    const first = service.ensureConnected(created.id);
    const second = service.ensureConnected(created.id);
    await Promise.resolve();
    ready();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('releases a failed attempt so the next refresh can reconnect', async () => {
    const connect = jest
      .spyOn(SSHConnection.prototype, 'connect')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const created = await service.create(config);
    await expect(service.ensureConnected(created.id)).rejects.toThrow('offline');
    await expect(service.ensureConnected(created.id)).resolves.toBeInstanceOf(
      SSHConnection,
    );
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('starts unknown and reports connecting then connected when a repository is opened', async () => {
    jest.spyOn(SSHConnection.prototype, 'connect').mockImplementation(async function (
      this: SSHConnection,
    ) {
      this.emit('connect');
    });
    const created = await service.create(config);
    expect(service.getStatus(created.id)).toMatchObject({ status: 'unknown' });
    await service.ensureConnected(created.id);
    expect(service.getStatus(created.id).status).toBe('connected');
    expect(events.emitConnectionStatus.mock.calls.map((call) => call[1])).toEqual([
      'connecting',
      'connected',
    ]);
  });

  it('reports a failed attempt as error with its message and never as online', async () => {
    jest
      .spyOn(SSHConnection.prototype, 'connect')
      .mockRejectedValue(new Error('Authentication failed'));
    const created = await service.create(config);
    await expect(service.test(created.id)).resolves.toMatchObject({
      success: false,
      status: 'error',
      error: 'Authentication failed',
    });
    expect(service.getStatus(created.id)).toMatchObject({
      status: 'error',
      error: 'Authentication failed',
    });
  });

  it('keeps the status of each connection isolated', async () => {
    const connect = jest
      .spyOn(SSHConnection.prototype, 'connect')
      .mockImplementationOnce(async function (this: SSHConnection) {
        this.emit('connect');
      })
      .mockRejectedValueOnce(new Error('offline'));
    const online = await service.create(config);
    const offline = await service.create({ ...config, name: 'Other' });
    await service.ensureConnected(online.id);
    await expect(service.ensureConnected(offline.id)).rejects.toThrow('offline');
    expect(service.getStatus(online.id).status).toBe('connected');
    expect(service.getStatus(offline.id).status).toBe('error');
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('reports a dropped connection as disconnected but keeps a reported failure', async () => {
    jest.spyOn(SSHConnection.prototype, 'connect').mockImplementation(async function (
      this: SSHConnection,
    ) {
      this.emit('connect');
    });
    const created = await service.create(config);
    const connection = await service.ensureConnected(created.id);
    connection.emit('disconnect');
    expect(service.getStatus(created.id).status).toBe('disconnected');
    // ssh2 closes the socket right after an error; the cause must survive.
    connection.emit('error', new Error('Connection reset'));
    connection.emit('disconnect');
    expect(service.getStatus(created.id)).toMatchObject({
      status: 'error',
      error: 'Connection reset',
    });
  });
});
