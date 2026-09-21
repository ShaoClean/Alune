import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NewFileDeletion, NewFileDeletionError } from '@alune/ssh-client';
import { GitService } from './git.service';
import { GitController } from './git.controller';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';

const id = '22222222-2222-4222-8222-222222222222';
const preview = {
  path: 'new.txt',
  token: 'a'.repeat(64),
  staged: true,
  hasUnstagedChanges: true,
  diskPresent: true,
};

describe('single new file deletion HTTP API', () => {
  let app: any;
  let connect: jest.Mock;
  beforeEach(async () => {
    connect = jest.fn().mockResolvedValue({});
    const module = await Test.createTestingModule({
      controllers: [GitController],
      providers: [
        GitService,
        { provide: ConnectionService, useValue: { ensureConnected: connect } },
        {
          provide: RepositoryService,
          useValue: {
            get: async () => ({ id, path: '/repo', connectionId: 'host' }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('previews without deleting, then passes the confirmed path and token to deletion', async () => {
    jest.spyOn(NewFileDeletion.prototype, 'preview').mockResolvedValue(preview);
    const remove = jest
      .spyOn(NewFileDeletion.prototype, 'delete')
      .mockResolvedValue({ success: true });
    await request(app.getHttpServer())
      .post(`/repositories/${id}/delete-new-file/preview`)
      .send({ path: preview.path })
      .expect(201, preview);
    expect(remove).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(`/repositories/${id}/delete-new-file`)
      .send({ path: preview.path, token: preview.token })
      .expect(201, { success: true });
    expect(remove).toHaveBeenCalledWith('/repo', preview.path, preview.token);
  });

  it('rejects missing or unsafe paths and invalid repository IDs before connecting', async () => {
    for (const body of [{}, { path: ['one', 'two'] }, { path: '../outside' }]) {
      await request(app.getHttpServer())
        .post(`/repositories/${id}/delete-new-file`)
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/repositories/invalid/delete-new-file')
      .send({ path: 'new.txt' })
      .expect(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns precise state-change, remote and partial-failure messages', async () => {
    const remove = jest.spyOn(NewFileDeletion.prototype, 'delete');
    for (const [error, status] of [
      [new NewFileDeletionError('文件内容已变化'), 409],
      [
        new NewFileDeletionError('磁盘文件：仍存在；暂存记录：已清理', 502),
        502,
      ],
      [new Error('SSH connection lost'), 502],
    ] as const) {
      remove.mockRejectedValueOnce(error);
      const response = await request(app.getHttpServer())
        .post(`/repositories/${id}/delete-new-file`)
        .send(preview)
        .expect(status);
      expect(response.body.message).toBe(error.message);
    }
  });

  it('blocks duplicate deletion until completion and releases the guard on failure', async () => {
    let fail!: (error: Error) => void;
    const remove = jest
      .spyOn(NewFileDeletion.prototype, 'delete')
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
    const service = app.get(GitService);
    const pending = service.deleteNewFile(id, preview.path, preview.token);
    const failure = expect(pending).rejects.toThrow('Permission denied');
    while (!fail) await new Promise((resolve) => setImmediate(resolve));
    await request(app.getHttpServer())
      .post(`/repositories/${id}/delete-new-file`)
      .send(preview)
      .expect(409);
    expect(remove).toHaveBeenCalledTimes(1);
    fail(new Error('Permission denied'));
    await failure;
    remove.mockResolvedValue({ success: true });
    await request(app.getHttpServer())
      .post(`/repositories/${id}/delete-new-file`)
      .send(preview)
      .expect(201);
  });
});
