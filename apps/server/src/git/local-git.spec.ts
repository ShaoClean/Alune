import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RepositoryService } from '../repository/repository.service';
import { RepositoryController } from '../repository/repository.controller';
import { ConnectionService } from '../connection/connection.service';
import { GitService } from './git.service';
import { GitController } from './git.controller';

jest.setTimeout(30_000);

describe('local repositories with real Git and SQLite', () => {
  let root: string;
  let path: string;
  let db: Database.Database;
  let repos: RepositoryService;
  let service: GitService;
  let ssh: jest.Mock;
  let app: any;
  let id: string;
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    system: process.env.GIT_CONFIG_NOSYSTEM,
  };
  const gitAt = (directory: string, ...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
    });
  const git = (...args: string[]) => gitAt(path, ...args);
  const write = (file: string, contents: string | Buffer) =>
    writeFileSync(join(path, file), contents);
  const seed = async () => {
    write('tracked.txt', 'first\n');
    await service.stage(id, ['tracked.txt']);
    await service.commit(id, 'first commit');
  };
  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = devNull;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
  });
  afterAll(() => {
    if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved.global;
    if (saved.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = saved.system;
  });
  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'alune-local-git-')));
    path = join(root, "本地 ' $repo");
    mkdirSync(path);
    git('init', '-q', '-b', 'main');
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(
      "CREATE TABLE connections (id TEXT PRIMARY KEY); INSERT INTO connections VALUES ('remote-host')",
    );
    ssh = jest
      .fn()
      .mockRejectedValue(new Error('Local Git must never connect over SSH'));
    const connection = { ensureConnected: ssh } as unknown as ConnectionService;
    repos = new RepositoryService(db, connection);
    service = new GitService(connection, repos);
    id = (await repos.addLocal(path)).id;
    await service.saveAuthor(id, 'Local fixture', 'fixture@example.invalid');
    const module = await Test.createTestingModule({
      controllers: [RepositoryController, GitController],
      providers: [
        { provide: RepositoryService, useValue: repos },
        { provide: GitService, useValue: service },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    db?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('opens subdirectories idempotently, isolates SSH identities, and validates invalid inputs through HTTP', async () => {
    mkdirSync(join(path, 'src'));
    expect((await repos.addLocal(join(path, 'src'))).id).toBe(id);
    const remote = await repos.add('remote-host', path);
    expect(remote.id).not.toBe(id);
    const response = await request(app.getHttpServer())
      .post('/repositories/local/inspect')
      .send({ path })
      .expect(201);
    expect(response.body).toMatchObject({
      source: 'local',
      path,
      unborn: true,
      remotes: [],
    });
    expect(response.body.status.branch).toBe('main');
    for (const input of ['relative', join(root, 'missing'), root, null])
      await request(app.getHttpServer())
        .post('/repositories')
        .send({ source: 'local', path: input })
        .expect(400);
    expect(ssh).not.toHaveBeenCalled();
    await repos.delete(id);
    expect(existsSync(join(path, '.git'))).toBe(true);
    expect((await repos.get(remote.id)).source).toBe('ssh');
  });

  it('handles unborn HEAD, literal Unicode paths, first commit and staged/unstaged content independently', async () => {
    const file = "中文 ' $HOME [file].txt";
    write(file, 'staged version\n');
    write('other.txt', 'keep me\n');
    await service.stage(id, [file]);
    await service.unstage(id, [file]);
    expect(readFileSync(join(path, file), 'utf8')).toBe('staged version\n');
    await service.stage(id, [file]);
    write(file, 'working version\n');
    expect(await repos.getDiff(id, { file, staged: true })).toContain(
      '+staged version',
    );
    expect(await repos.getDiff(id, { file, staged: false })).toContain(
      '+working version',
    );
    await service.commit(id, "first ' $commit", 'description');
    expect(git('show', `HEAD:${file}`)).toBe('staged version\n');
    expect(readFileSync(join(path, file), 'utf8')).toBe('working version\n');
    expect(git('ls-files')).not.toContain('other.txt');
    await service.checkout(id, [file]);
    expect(readFileSync(join(path, file), 'utf8')).toBe('staged version\n');
    expect((await repos.getLog(id)).commits).toHaveLength(1);
    expect((await repos.getCommitFiles(id, 'HEAD'))[0].path).toBe(file);
    expect((await repos.getStatus(id)).unborn).toBeUndefined();
    expect(ssh).not.toHaveBeenCalled();
  });

  it('supports branch create/switch/rename/delete and merge, reporting conflict without hiding changed state', async () => {
    await seed();
    await service.createBranch(id, 'feature', true);
    write('feature.txt', 'feature\n');
    await service.stage(id, ['feature.txt']);
    await service.commit(id, 'feature');
    await service.renameBranch(id, 'feature', 'renamed');
    await service.switchBranch(id, 'main');
    await service.merge(id, 'renamed');
    await service.deleteBranch(id, 'renamed');
    expect((await repos.getBranches(id)).map((item) => item.name)).toEqual([
      'main',
    ]);
    await service.createBranch(id, 'conflict', true);
    write('tracked.txt', 'branch\n');
    await service.stage(id, ['tracked.txt']);
    await service.commit(id, 'branch edit');
    await service.switchBranch(id, 'main');
    write('tracked.txt', 'main\n');
    await service.stage(id, ['tracked.txt']);
    await service.commit(id, 'main edit');
    await expect(service.merge(id, 'conflict')).rejects.toThrow();
    expect(
      (await repos.getStatus(id)).files.some((file) => file.conflicted),
    ).toBe(true);
  });

  it('previews/apply/pop/drop stashes, including untracked files when selected', async () => {
    await seed();
    write('tracked.txt', 'change\n');
    write('new.txt', 'new file\n');
    await request(app.getHttpServer())
      .post(`/repositories/${id}/stash`)
      .send({ message: 'local snapshot', includeUntracked: true })
      .expect(201);
    expect(existsSync(join(path, 'new.txt'))).toBe(false);
    const list = await repos.getStashes(id);
    expect(list[0]).toMatchObject({ index: 0 });
    expect(list[0].message).toContain('local snapshot');
    expect((await service.stashShow(id, 0)).diff).toContain('new file');
    await service.stashApply(id, 0);
    expect(existsSync(join(path, 'new.txt'))).toBe(true);
    await service.stashDrop(id, 0);
    expect(await repos.getStashes(id)).toHaveLength(0);
    await service.stash(id, 'again', true);
    await service.stashPop(id, 0);
    expect(await repos.getStashes(id)).toHaveLength(0);
    expect(readFileSync(join(path, 'tracked.txt'), 'utf8')).toBe('change\n');
  });

  it('never discards a same-named file when a branch is missing', async () => {
    await seed();
    write('missing-branch', 'original\n');
    await service.stage(id, ['missing-branch']);
    await service.commit(id, 'same-named file');
    write('missing-branch', 'keep working change\n');
    await expect(service.switchBranch(id, 'missing-branch')).rejects.toThrow();
    expect(readFileSync(join(path, 'missing-branch'), 'utf8')).toBe(
      'keep working change\n',
    );
    expect(git('branch', '--show-current').trim()).toBe('main');
  });

  it('publishes the current branch to a differently named upstream and rejects refspec deletion', async () => {
    await seed();
    const remotePath = join(root, 'remote.git');
    mkdirSync(remotePath);
    gitAt(remotePath, 'init', '--bare', '-q', '-b', 'main');
    await service.addRemote(id, 'origin', remotePath);
    await service.push(id, 'origin', 'published', false, true);
    expect((await repos.getContext(id)).upstream).toBe('origin/published');
    expect(gitAt(remotePath, 'rev-parse', 'refs/heads/published').trim()).toBe(
      git('rev-parse', 'HEAD').trim(),
    );
    await expect(service.push(id, 'origin', ':published')).rejects.toThrow();
    expect(gitAt(remotePath, 'rev-parse', 'refs/heads/published').trim()).toBe(
      git('rev-parse', 'HEAD').trim(),
    );
    git('checkout', '--detach');
    await expect(
      service.push(id, 'origin', 'detached', false, true),
    ).rejects.toThrow('本地分支');
    expect(gitAt(remotePath, 'branch', '--list', 'detached')).toBe('');
  });

  it('adds a remote, sets upstream on push, fetches/pulls and deepens a shallow clone', async () => {
    await seed();
    const remotePath = join(root, 'remote.git');
    mkdirSync(remotePath);
    gitAt(remotePath, 'init', '--bare', '-q', '-b', 'main');
    await service.addRemote(id, 'origin', remotePath);
    await request(app.getHttpServer())
      .post(`/repositories/${id}/push`)
      .send({ remote: 'origin', branch: 'main', setUpstream: true })
      .expect(201);
    expect((await repos.getContext(id)).upstream).toBe('origin/main');
    write('tracked.txt', 'second\n');
    await service.stage(id, ['tracked.txt']);
    await service.commit(id, 'second');
    await service.push(id);
    const clone = join(root, 'shallow');
    gitAt(
      root,
      'clone',
      '-q',
      '--depth=1',
      pathToFileURL(remotePath).href,
      clone,
    );
    const cloned = await repos.addLocal(clone);
    expect((await repos.getContext(cloned.id)).shallow).toBe(true);
    await service.deepen(cloned.id);
    expect((await repos.getLog(cloned.id)).commits).toHaveLength(2);
    write('third.txt', 'third');
    await service.stage(id, ['third.txt']);
    await service.commit(id, 'third');
    await service.push(id);
    await service.fetch(cloned.id);
    expect((await repos.getStatus(cloned.id)).behind).toBe(1);
    await service.pull(cloned.id);
    expect(readFileSync(join(clone, 'third.txt'), 'utf8')).toBe('third');
  });

  it('creates/opens worktrees and refuses deletion of current, dirty, ignored, nested or unconfirmed targets', async () => {
    await seed();
    const sibling = join(root, 'feature worktree');
    const opened = await service.createWorktree(id, sibling, 'feature');
    const listedPath = (await repos.getWorktrees(id)).find(
      (item) => !item.isCurrent,
    )!.path;
    expect((await repos.openWorktree(id, listedPath)).id).toBe(opened.id);
    await expect(service.removeWorktree(id, path, true)).rejects.toThrow();
    await expect(
      service.removeWorktree(id, listedPath, false),
    ).rejects.toThrow();
    writeFileSync(join(sibling, 'untracked.txt'), 'keep');
    await expect(service.removeWorktree(id, listedPath, true)).rejects.toThrow(
      '未跟踪',
    );
    rmSync(join(sibling, 'untracked.txt'));
    gitAt(sibling, 'config', 'core.excludesFile', join(root, 'ignore'));
    writeFileSync(join(root, 'ignore'), 'ignored.txt\n');
    writeFileSync(join(sibling, 'ignored.txt'), 'keep ignored');
    await expect(service.removeWorktree(id, listedPath, true)).rejects.toThrow(
      '忽略',
    );
    rmSync(join(sibling, 'ignored.txt'));
    await expect(
      service.createWorktree(id, join(path, '..nested'), 'nested'),
    ).rejects.toThrow('之外');
    const removed = await service.removeWorktree(id, listedPath, true);
    expect(removed.removedIds).toEqual([opened.id]);
    expect(existsSync(sibling)).toBe(false);
    expect(git('branch', '--list', 'feature')).toContain('feature');
    expect(existsSync(path)).toBe(true);
  });

  it('reads text/image/binary and performs token-confirmed deletion with the local transport', async () => {
    await seed();
    write('binary.dat', Buffer.from([0, 255, 1]));
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    );
    write('pixel.png', png);
    expect(
      (await repos.listTree(id, '')).entries.some(
        (item) => item.name === '.git',
      ),
    ).toBe(false);
    expect(await repos.readFile(id, 'tracked.txt')).toMatchObject({
      kind: 'text',
      content: 'first\n',
    });
    expect(await repos.readFile(id, 'binary.dat')).toMatchObject({
      kind: 'binary',
    });
    await service.stage(id, ['pixel.png']);
    const image = await repos.getDiffImage(id, {
      file: 'pixel.png',
      side: 'after',
      staged: true,
    });
    expect(Buffer.from(image.content, 'base64')).toEqual(png);
    const preview = (await service.deleteNewFile(
      id,
      'binary.dat',
      undefined,
      true,
    )) as any;
    await service.deleteNewFile(id, 'binary.dat', preview.token);
    expect(existsSync(join(path, 'binary.dat'))).toBe(false);
    await expect(service.stage(id, ['../outside'])).rejects.toThrow();
  });
});

describe('repository database upgrade', () => {
  it('preserves legacy SSH records, pins and credentials when allowing local repositories', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(
      "CREATE TABLE connections (id TEXT PRIMARY KEY, password TEXT); INSERT INTO connections VALUES ('host', 'unchanged-secret'); CREATE TABLE repositories (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, pinned INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(connection_id) REFERENCES connections(id)); INSERT INTO repositories VALUES ('old', 'host', 'legacy', '/srv/legacy', 1, '2025-01-01');",
    );
    try {
      const repos = new RepositoryService(db, {} as ConnectionService);
      expect(await repos.get('old')).toMatchObject({
        source: 'ssh',
        connectionId: 'host',
      });
      expect(
        db.prepare('SELECT pinned, created_at FROM repositories').get(),
      ).toEqual({ pinned: 1, created_at: '2025-01-01' });
      expect(db.prepare('SELECT password FROM connections').get()).toEqual({
        password: 'unchanged-secret',
      });
      new RepositoryService(db, {} as ConnectionService);
      expect(await repos.list()).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
