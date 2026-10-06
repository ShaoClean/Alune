import { Test } from '@nestjs/testing';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { RepositoryService } from '../repository/repository.service';
import { ConnectionService } from '../connection/connection.service';
import { startServer } from '../bootstrap';

jest.setTimeout(30_000);

describe('interactive rebase HTTP flow with real local Git', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const route = `/repositories/${id}/interactive-rebase`;
  let root: string;
  let repo: string;
  let base: string;
  let app: any;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const commit = (content: string) => {
    writeFileSync(join(repo, 'file'), content);
    git('add', '--', 'file');
    git('commit', '-qm', content);
    return git('rev-parse', 'HEAD');
  };
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'alune-rebase-api-'));
    repo = join(root, 'repo');
    mkdirSync(repo);
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.editor', 'false');
    base = commit('base');
    const module = await Test.createTestingModule({
      controllers: [GitController],
      providers: [
        GitService,
        {
          provide: RepositoryService,
          useValue: { get: async () => ({ id, source: 'local', path: repo }) },
        },
        {
          provide: ConnectionService,
          useValue: {
            ensureConnected: jest.fn(() => {
              throw new Error('Unexpected SSH');
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('previews without changing HEAD, then applies and refreshes completed state', async () => {
    const first = commit('first');
    const before = git('rev-parse', 'HEAD');
    const preview = await request(app.getHttpServer())
      .post(`${route}/preview`)
      .send({ base })
      .expect(201);
    expect(git('rev-parse', 'HEAD')).toBe(before);
    const response = await request(app.getHttpServer())
      .post(route)
      .send({
        base,
        token: preview.body.token,
        entries: [
          { hash: first, action: 'reword', message: 'Renamed\n\nBody' },
        ],
      })
      .expect(201);
    expect(response.body.error).toBeUndefined();
    expect(response.body.state.active).toBe(false);
    expect(git('log', '-1', '--format=%B')).toBe('Renamed\n\nBody');
    const state = await request(app.getHttpServer()).get(route).expect(200);
    expect(state.body.active).toBe(false);
  });

  it('exposes conflicts, blocks unrelated writes, resolves, continues and aborts the next conflict', async () => {
    const first = commit('first');
    const second = commit('second');
    const tagsRoute = `/repositories/${id}/tags`;
    await request(app.getHttpServer())
      .post(tagsRoute)
      .send({ name: 'before-rebase', type: 'lightweight' })
      .expect(201);
    const preview = await request(app.getHttpServer())
      .post(`${route}/preview`)
      .send({ base })
      .expect(201);
    const start = await request(app.getHttpServer())
      .post(route)
      .send({
        base,
        token: preview.body.token,
        entries: [
          { hash: second, action: 'pick' },
          { hash: first, action: 'pick' },
        ],
      })
      .expect(201);
    expect(start.body.state.conflicts).toEqual(['file']);
    const pausedHead = git('rev-parse', 'HEAD');
    const pausedStatus = git('status', '--porcelain');
    const tag = { name: 'before-rebase', objectHash: second };
    const listed = await request(app.getHttpServer()).get(tagsRoute).expect(200);
    expect(listed.body).toEqual([expect.objectContaining(tag)]);
    for (const [endpoint, body] of [
      ['', { name: 'during-rebase', type: 'lightweight' }],
      ['/delete', { ...tag, confirmed: true }],
      ['/push', { name: tag.name, remote: 'origin' }],
      ['/checkout', { ...tag, branch: 'must-not-exist' }],
      ['/checkout', { ...tag, confirmed: true }],
    ] as const) {
      const blocked = await request(app.getHttpServer())
        .post(`${tagsRoute}${endpoint}`)
        .send(body)
        .expect(409);
      expect(blocked.body.message).toContain('交互式变基');
    }
    expect(git('rev-parse', 'HEAD')).toBe(pausedHead);
    expect(git('status', '--porcelain')).toBe(pausedStatus);
    expect(git('tag', '--list')).toBe(tag.name);
    expect(git('rev-parse', `refs/tags/${tag.name}`)).toBe(second);
    expect(git('branch', '--list', 'must-not-exist')).toBe('');
    await request(app.getHttpServer())
      .post(`/repositories/${id}/commit`)
      .send({ message: 'must not commit' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`${route}/control`)
      .send({ action: 'continue' })
      .expect(400);
    const conflict = await request(app.getHttpServer())
      .post(`${route}/conflict`)
      .send({ path: 'file' })
      .expect(201);
    expect(conflict.body.theirs).toBe('second');
    await request(app.getHttpServer())
      .post(`${route}/resolve`)
      .send({ path: 'file', token: conflict.body.token, choice: 'theirs' })
      .expect(201);
    const next = await request(app.getHttpServer())
      .post(`${route}/control`)
      .send({ action: 'continue' })
      .expect(201);
    expect(next.body.state.inProgress).toBe(true);
    const aborted = await request(app.getHttpServer())
      .post(`${route}/control`)
      .send({ action: 'abort' })
      .expect(201);
    expect(aborted.body.state.active).toBe(false);
    expect(git('rev-parse', 'HEAD')).toBe(second);
    await request(app.getHttpServer())
      .post(tagsRoute)
      .send({ name: 'after-rebase', type: 'lightweight' })
      .expect(201);
    expect(git('rev-parse', 'refs/tags/after-rebase')).toBe(second);
  });

  it.each(['continue', 'skip', 'abort'] as const)(
    'shared conflict controls %s a managed rebase while preserving messages and cleanup',
    async (action) => {
      const first = commit('first');
      const second = commit('second');
      const preview = await request(app.getHttpServer())
        .post(`${route}/preview`)
        .send({ base })
        .expect(201);
      await request(app.getHttpServer())
        .post(route)
        .send({
          base,
          token: preview.body.token,
          entries: [
            { hash: second, action: 'reword', message: 'Second rewritten' },
            { hash: first, action: 'reword', message: 'First rewritten' },
          ],
        })
        .expect(201);
      const resolve = async () => {
        await request(app.getHttpServer())
          .post(`/repositories/${id}/conflicts/resolve-file`)
          .send({ file: 'file', side: 'incoming' })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/repositories/${id}/stage`)
          .send({ files: ['file'] })
          .expect(201);
      };
      if (action === 'continue') await resolve();
      const result = await request(app.getHttpServer())
        .post(`/repositories/${id}/conflicts/${action}`)
        .expect(201);
      expect(result.body.success).toBe(true);
      if (action === 'continue') {
        expect(result.body.conflicts).toBe(true);
        expect(git('log', '-1', '--format=%B')).toBe('Second rewritten');
        await resolve();
        const finished = await request(app.getHttpServer())
          .post(`/repositories/${id}/conflicts/continue`)
          .expect(201);
        expect(finished.body.conflicts).toBe(false);
      }
      const state = await request(app.getHttpServer()).get(route).expect(200);
      expect(state.body.active).toBe(false);
      expect(git('status', '--porcelain')).toBe('');
      if (action === 'abort') expect(git('rev-parse', 'HEAD')).toBe(second);
      else expect(git('log', '-1', '--format=%B')).toBe('First rewritten');
    },
  );

  it('rejects malformed input and stale previews before touching the branch', async () => {
    const first = commit('first');
    await request(app.getHttpServer())
      .post(`${route}/preview`)
      .send({ base: '-x' })
      .expect(400);
    await request(app.getHttpServer()).post(route).send({}).expect(400);
    await request(app.getHttpServer())
      .post(`${route}/control`)
      .send({ action: 'quit' })
      .expect(400);
    const preview = await request(app.getHttpServer())
      .post(`${route}/preview`)
      .send({ base })
      .expect(201);
    const second = commit('second');
    await request(app.getHttpServer())
      .post(route)
      .send({
        base,
        token: preview.body.token,
        entries: [{ hash: first, action: 'pick' }],
      })
      .expect(400);
    expect(git('rev-parse', 'HEAD')).toBe(second);
    await request(app.getHttpServer())
      .post(`${route}/conflict`)
      .send({ path: '../../outside' })
      .expect(400);
  });

  it('boots with normal JSON routes, a larger rebase budget, and the normal size limit elsewhere', async () => {
    for (let i = 0; i < 4; i++) commit(`long-message-${i}`);
    const previous = process.env.ALUNE_DATA_DIR;
    process.env.ALUNE_DATA_DIR = join(root, 'server-data');
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      server = await startServer({
        host: '127.0.0.1',
        port: 0,
        webRoot: root,
        token: 'test-rebase-only',
      });
      const http = server.getHttpServer();
      const auth = 'Bearer test-rebase-only';
      await request(http)
        .post('/api/repositories')
        .send({ source: 'local', path: repo })
        .expect(401);
      const added = await request(http)
        .post('/api/repositories')
        .set('Authorization', auth)
        .send({ source: 'local', path: repo })
        .expect(201);
      const endpoint = `/api/repositories/${added.body.id}/interactive-rebase`;
      const preview = await request(http)
        .post(`${endpoint}/preview`)
        .set('Authorization', auth)
        .send({ base })
        .expect(201);
      const entries = preview.body.commits.map(
        (entry: { hash: string }, index: number) => ({
          hash: entry.hash,
          action: 'reword',
          message: `Message ${index}\n\n${'x'.repeat(30_000)}`,
        }),
      );
      const result = await request(http)
        .post(endpoint)
        .set('Authorization', auth)
        .send({ base, token: preview.body.token, entries })
        .expect(201);
      expect(result.body.error).toBeUndefined();
      expect(result.body.state.active).toBe(false);
      expect(git('log', '-1', '--format=%B')).toHaveLength(30_011);
      await request(http)
        .post(`/api/repositories/${added.body.id}/commit`)
        .set('Authorization', auth)
        .send({ message: 'x'.repeat(110_000) })
        .expect(413);
      await request(http)
        .post(endpoint)
        .set('Authorization', auth)
        .send({ entries: 'x'.repeat(1024 * 1024) })
        .expect(413);
    } finally {
      await server?.close();
      if (previous === undefined) delete process.env.ALUNE_DATA_DIR;
      else process.env.ALUNE_DATA_DIR = previous;
    }
  });
});
