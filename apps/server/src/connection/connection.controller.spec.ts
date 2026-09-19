import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionController } from './connection.controller';
import { ConnectionService } from './connection.service';

describe('ConnectionController', () => {
  let controller: ConnectionController;
  const stored = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Fixture',
    host: 'fixture.invalid',
    port: 22,
    username: 'fixture',
    authType: 'password' as const,
    password: 'secret',
  };
  const service = {
    list: jest.fn(),
    get: jest.fn(),
    getStatus: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    service.list.mockResolvedValue([stored]);
    service.get.mockResolvedValue(stored);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectionController],
    })
      .useMocker((token) => (token === ConnectionService ? service : undefined))
      .compile();

    controller = module.get<ConnectionController>(ConnectionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('reports the live SSH status without leaking credentials', async () => {
    service.getStatus.mockReturnValue({ status: 'connected', updatedAt: 42 });
    const [listed] = await controller.list();
    expect(listed).toEqual({
      id: stored.id,
      name: stored.name,
      host: stored.host,
      port: stored.port,
      username: stored.username,
      authType: stored.authType,
      hasAuth: true,
      status: 'connected',
      updatedAt: 42,
    });
    expect(await controller.get(stored.id)).toMatchObject({ status: 'connected' });
  });

  it('reports a never attempted connection as unknown', async () => {
    service.getStatus.mockReturnValue({ status: 'unknown' });
    const [listed] = await controller.list();
    expect(listed).toMatchObject({ status: 'unknown' });
    expect(listed).not.toHaveProperty('password');
  });
});
