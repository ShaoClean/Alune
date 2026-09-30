import { Test } from '@nestjs/testing';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  realpathSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { RepositoryService } from '../repository/repository.service';
import { ConnectionService } from '../connection/connection.service';

const id = 'c33d58c1-cf2c-4da1-b9a4-d1414025f049';
describe('workspace file HTTP actions', () => {
  let root: string;
  let app: any;
  let service: GitService;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  beforeEach(async () => {
    root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'alune-workspace-http-')),
    );
    git('init', '-q');
    writeFileSync(join(root, '中文 文件.txt'), 'staged');
    git('add', '.');
    writeFileSync(join(root, '中文 文件.txt'), 'unstaged');
    service = new GitService(
      {} as ConnectionService,
      {
        get: async () => ({ id, source: 'local', path: root }),
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
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const preview = () =>
    request(app.getHttpServer())
      .post(`/repositories/${id}/workspace-file/preview`)
      .send({ path: '中文 文件.txt' })
      .expect(201);
  it('previews, rejects invalid/stale confirmations and preserves index through rename/delete', async () => {
    const index = git('ls-files', '--stage', '-z');
    const { body } = await preview();
    expect(body).toMatchObject({
      path: '中文 文件.txt',
      absolutePath: join(root, '中文 文件.txt').replace(/\\/g, '/'),
      staged: true,
      canModify: true,
    });
    await request(app.getHttpServer())
      .post(`/repositories/${id}/workspace-file`)
      .send({ path: body.path, token: 'bad', action: 'delete' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/repositories/${id}/workspace-file`)
      .send({ path: body.path, token: body.token, action: 'unknown' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/repositories/${id}/workspace-file`)
      .send({
        path: body.path,
        token: body.token,
        action: 'rename',
        name: 'new.txt',
      })
      .expect(201);
    expect(existsSync(join(root, 'new.txt'))).toBe(true);
    expect(git('ls-files', '--stage', '-z')).toBe(index);
    await request(app.getHttpServer())
      .post(`/repositories/${id}/workspace-file`)
      .send({ path: body.path, token: body.token, action: 'delete' })
      .expect(409);
    const { body: next } = await request(app.getHttpServer())
      .post(`/repositories/${id}/workspace-file/preview`)
      .send({ path: 'new.txt' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/repositories/${id}/workspace-file`)
      .send({ path: 'new.txt', token: next.token, action: 'delete' })
      .expect(201);
    expect(existsSync(join(root, 'new.txt'))).toBe(false);
    expect(git('ls-files', '--stage', '-z')).toBe(index);
  });
  it('renames case only according to the native filesystem', async () => {
    const { body } = await preview();
    await request(app.getHttpServer())
      .post(`/repositories/${id}/workspace-file`)
      .send({
        path: body.path,
        token: body.token,
        action: 'rename',
        name: '中文 文件.TXT',
      })
      .expect(201);
    expect(readdirSync(root)).toContain('中文 文件.TXT');
    expect(readdirSync(root)).not.toContain('中文 文件.txt');
    expect(git('show', ':中文 文件.txt')).toBe('staged');
  });
  it('validates payload, scope and UUID before any write', async () => {
    for (const body of [
      {},
      { path: '../outside' },
      { path: '.git/index' },
      { path: 1 },
    ])
      await request(app.getHttpServer())
        .post(`/repositories/${id}/workspace-file/preview`)
        .send(body)
        .expect(400);
    await request(app.getHttpServer())
      .post('/repositories/invalid/workspace-file/preview')
      .send({ path: '中文 文件.txt' })
      .expect(400);
    expect(existsSync(join(root, '中文 文件.txt'))).toBe(true);
  });
});
