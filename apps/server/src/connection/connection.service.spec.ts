import Database from 'better-sqlite3';
import { SSHConnection } from '@remote-git/ssh-client';
import { ConnectionService } from './connection.service';

describe('ConnectionService concurrent status reads', () => {
  let db: Database.Database;
  let service: ConnectionService;
  beforeEach(() => {
    db = new Database(':memory:');
    service = new ConnectionService(db);
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
    const config = await service.create({
      name: 'Fixture',
      host: 'fixture.invalid',
      port: 22,
      username: 'fixture',
      authType: 'password',
    });
    const first = service.ensureConnected(config.id);
    const second = service.ensureConnected(config.id);
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
    const config = await service.create({
      name: 'Fixture',
      host: 'fixture.invalid',
      port: 22,
      username: 'fixture',
      authType: 'password',
    });
    await expect(service.ensureConnected(config.id)).rejects.toThrow('offline');
    await expect(service.ensureConnected(config.id)).resolves.toBeInstanceOf(
      SSHConnection,
    );
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
