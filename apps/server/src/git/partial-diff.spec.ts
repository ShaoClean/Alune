import { Test } from '@nestjs/testing';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartialChanges, LocalConnection } from '@alune/ssh-client';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { RepositoryService } from '../repository/repository.service';
import { ConnectionService } from '../connection/connection.service';

const id = '5cf1912b-c485-4eef-a6f3-4b8693d2c095';
describe('partial diff HTTP with real Git', () => {
  let root: string;
  let app: any;
  let service: GitService;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'alune-partial-http-'));
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(join(root, 'file.txt'), 'old\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    writeFileSync(join(root, 'file.txt'), 'new\n');
    service = new GitService(
      {} as ConnectionService,
      {
        get: async () => ({ id, path: root, source: 'local' }),
      } as unknown as RepositoryService,
    );
    const module = await Test.createTestingModule({
      controllers: [GitController],
      providers: [{ provide: GitService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    rmSync(root, { force: true, recursive: true });
  });
  const preview = () =>
    new PartialChanges(new LocalConnection()).preview(root, 'file.txt', false);
  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post(`/repositories/${id}/partial-diff`)
      .send(body);

  it('stages trusted selections and rejects replayed revisions with 409', async () => {
    const view = await preview();
    const body = {
      file: 'file.txt',
      action: 'stage',
      revision: view.revision,
      selection: { hunks: [0] },
    };
    await post(body).expect(201, { success: true });
    expect(git('show', ':file.txt')).toBe('new\n');
    await post(body).expect(409);
    expect(service.operation(id)).toBeNull();
  });
  it('requires discard confirmation, validates paths/selections and returns useful errors', async () => {
    const view = await preview();
    const body = {
      file: 'file.txt',
      action: 'discard',
      revision: view.revision,
      selection: { hunks: [0] },
    };
    const confirmation = await post(body).expect(400);
    expect(confirmation.body.message).toMatch(/确认/);
    await post({ ...body, confirmed: true, file: '../outside' }).expect(400);
    await post({ ...body, confirmed: true, selection: { lines: [0] } }).expect(
      400,
    );
    await post({ ...body, confirmed: true }).expect(201);
    expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('old\n');
  });
  it('serializes with other Git writes and releases the guard after a failure', async () => {
    const view = await preview();
    let release!: () => void;
    const apply = jest
      .spyOn(PartialChanges.prototype, 'apply')
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw new Error('fixture failure');
      });
    const body = {
      file: 'file.txt',
      action: 'stage' as const,
      revision: view.revision!,
      selection: { hunks: [0] },
    };
    const first = service.partialDiff(id, body);
    const rejected = expect(first).rejects.toThrow('fixture failure');
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await post(body).expect(409);
    release();
    await rejected;
    apply.mockRestore();
    await post(body).expect(201);
    expect(service.operation(id)).toBeNull();
  });
});
