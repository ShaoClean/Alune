import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DiscardChanges, DiscardChangesError } from '@alune/ssh-client';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitService } from './git.service';
import { GitController } from './git.controller';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';

const id = '22222222-2222-4222-8222-222222222222';
const completed = {
  success: true,
  restored: 1,
  deleted: 0,
  remaining: 0,
  unknown: 0,
};

describe('discard all changes HTTP API', () => {
  let app: any;
  let root: string;
  let connect: jest.Mock;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'alune-discard-api-'));
    git('init', '-q');
    writeFileSync(join(root, 'staged.txt'), 'index\n');
    git('add', '--', 'staged.txt');
    writeFileSync(join(root, 'staged.txt'), 'working\n');
    writeFileSync(join(root, 'untracked.txt'), 'new\n');
    connect = jest.fn();
    const module = await Test.createTestingModule({
      controllers: [GitController],
      providers: [
        GitService,
        { provide: ConnectionService, useValue: { ensureConnected: connect } },
        {
          provide: RepositoryService,
          useValue: {
            get: async () => ({
              id,
              name: 'API fixture',
              path: root,
              source: 'local',
            }),
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
    rmSync(root, { recursive: true, force: true });
  });

  const preview = () =>
    request(app.getHttpServer())
      .post(`/repositories/${id}/discard-changes/preview`)
      .expect(201);

  it('previews the whole repository and preserves staged content by default', async () => {
    const before = git('ls-files', '--stage', '-z');
    const { body } = await preview();
    expect(body).toMatchObject({
      repositoryName: 'API fixture',
      repositoryPath: root,
      tracked: 1,
      untracked: 1,
    });
    expect(readFileSync(join(root, 'staged.txt'), 'utf8')).toBe('working\n');
    expect(git('ls-files', '--stage', '-z')).toBe(before);
    await request(app.getHttpServer())
      .post(`/repositories/${id}/discard-changes`)
      .send({ token: body.token, scope: 'tracked', files: ['../outside'] })
      .expect(201, completed);
    expect(readFileSync(join(root, 'staged.txt'), 'utf8')).toBe('index\n');
    expect(existsSync(join(root, 'untracked.txt'))).toBe(true);
    expect(git('ls-files', '--stage', '-z')).toBe(before);
    const next = await preview();
    await request(app.getHttpServer())
      .post(`/repositories/${id}/discard-changes`)
      .send({ token: next.body.token, scope: 'all' })
      .expect(201, { ...completed, restored: 0, deleted: 1 });
    expect(existsSync(join(root, 'untracked.txt'))).toBe(false);
  });

  it('rejects invalid confirmation or scope before opening a transport', async () => {
    const discard = jest.spyOn(DiscardChanges.prototype, 'discard');
    for (const body of [
      {},
      { token: 'bad', scope: 'all' },
      { token: 'a'.repeat(64), scope: true },
    ]) {
      await request(app.getHttpServer())
        .post(`/repositories/${id}/discard-changes`)
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/repositories/invalid/discard-changes/preview')
      .expect(400);
    expect(discard).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns 409 when contents changed after confirmation, without touching disk or index', async () => {
    const { body } = await preview();
    writeFileSync(join(root, 'staged.txt'), 'newer edit\n');
    await request(app.getHttpServer())
      .post(`/repositories/${id}/discard-changes`)
      .send({ token: body.token, scope: 'all' })
      .expect(409);
    expect(readFileSync(join(root, 'staged.txt'), 'utf8')).toBe('newer edit\n');
    expect(git('show', ':staged.txt')).toBe('index\n');
    expect(existsSync(join(root, 'untracked.txt'))).toBe(true);
  });

  it('returns partial results without claiming full success', async () => {
    const partial = {
      ...completed,
      success: false,
      remaining: 1,
      error: 'Permission denied',
    };
    jest.spyOn(DiscardChanges.prototype, 'discard').mockResolvedValue(partial);
    await request(app.getHttpServer())
      .post(`/repositories/${id}/discard-changes`)
      .send({ token: 'a'.repeat(64), scope: 'all' })
      .expect(201, partial);
  });

  it('uses the shared write guard for duplicate discard and other Git writes, releasing it on failure', async () => {
    let fail!: (error: Error) => void;
    const discard = jest
      .spyOn(DiscardChanges.prototype, 'discard')
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
    const service = app.get(GitService);
    const pending = service.discardChanges(id, 'a'.repeat(64), 'all');
    const failure = expect(pending).rejects.toThrow('SSH disconnected');
    while (!fail) await new Promise((resolve) => setImmediate(resolve));
    for (const [operation, body] of [
      ['discard-changes', { token: 'a'.repeat(64), scope: 'all' }],
      ['stage', { files: ['untracked.txt'] }],
    ]) {
      await request(app.getHttpServer())
        .post(`/repositories/${id}/${operation}`)
        .send(body)
        .expect(409);
    }
    expect(discard).toHaveBeenCalledTimes(1);
    fail(new Error('SSH disconnected'));
    await failure;
    discard.mockResolvedValue(completed);
    await request(app.getHttpServer())
      .post(`/repositories/${id}/discard-changes`)
      .send({ token: 'a'.repeat(64), scope: 'tracked' })
      .expect(201, completed);
  });

  it('reports understandable blocking and transport failures for preview and execution', async () => {
    const inspect = jest.spyOn(DiscardChanges.prototype, 'preview');
    const discard = jest.spyOn(DiscardChanges.prototype, 'discard');
    for (const [error, status] of [
      [new DiscardChangesError('仓库存在合并冲突'), 409],
      [new Error('SSH disconnected'), 502],
    ] as const) {
      inspect.mockRejectedValueOnce(error);
      const response = await request(app.getHttpServer())
        .post(`/repositories/${id}/discard-changes/preview`)
        .expect(status);
      expect(response.body.message).toBe(error.message);
      discard.mockRejectedValueOnce(error);
      const write = await request(app.getHttpServer())
        .post(`/repositories/${id}/discard-changes`)
        .send({ token: 'a'.repeat(64), scope: 'all' })
        .expect(status);
      expect(write.body.message).toBe(error.message);
    }
  });
});
