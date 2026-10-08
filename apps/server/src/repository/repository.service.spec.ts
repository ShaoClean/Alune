import Database from 'better-sqlite3';
import { NotFoundException } from '@nestjs/common';
import { GitCommands, GitWorktrees, RepositoryFiles, GitSubmodules, runGit } from '@alune/ssh-client';
import { REPOSITORY_STATUS_TIMEOUT_MS } from '@alune/shared';
import { RepositoryService } from './repository.service';
import { ConnectionService } from '../connection/connection.service';

const status = { branch: 'main', files: [], ahead: 1, behind: 0 };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('RepositoryService registration and remote status', () => {
  let db: Database.Database;
  let service: RepositoryService;
  let ensureConnected: jest.Mock;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(
      "CREATE TABLE connections (id TEXT PRIMARY KEY); INSERT INTO connections VALUES ('host-a'), ('host-b')",
    );
    ensureConnected = jest.fn().mockResolvedValue({});
    service = new RepositoryService(db, {
      ensureConnected,
    } as unknown as ConnectionService);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    db.close();
  });

  it('scopes Git and SFTP cancellation to the requesting transport', async () => {
    const execCommand = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const withSftp = jest.fn().mockResolvedValue('file');
    const connection = { execCommand, withSftp };
    ensureConnected.mockResolvedValue(connection);
    const repo = await service.add('host-a', '/fixture/repo');
    const controller = new AbortController();
    const transport = await service.connection(repo, controller.signal);
    await runGit(transport, repo.path, ['diff']);
    expect(execCommand.mock.calls[0][2]).toBe(controller.signal);
    const read = async () => 'file';
    await transport.withSftp(read);
    expect(withSftp).toHaveBeenCalledWith(read, controller.signal);
    controller.abort();
    await expect(runGit(transport, repo.path, ['diff'])).rejects.toThrow();
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(await service.connection(repo)).toBe(connection);
  });

  it('opens registered submodules on the same SSH host and reuses their registration', async () => {
    const parent = await service.add('host-b', '/fixture/parent');
    const resolve = jest
      .spyOn(GitSubmodules.prototype, 'resolve')
      .mockResolvedValue('/fixture/parent/modules/core');
    const first = await service.openSubmodule(parent.id, 'modules/core');
    const second = await service.openSubmodule(parent.id, 'modules/core');
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      source: 'ssh',
      connectionId: 'host-b',
      path: '/fixture/parent/modules/core',
    });
    expect(ensureConnected).toHaveBeenCalledWith('host-b');
    expect(resolve).toHaveBeenCalledWith('/fixture/parent', 'modules/core');
    expect(await service.list('host-b')).toHaveLength(2);
    resolve.mockRejectedValue(new Error('请先初始化所选子模块。'));
    await expect(service.openSubmodule(parent.id, 'missing')).rejects.toThrow(
      '初始化',
    );
    expect(await service.list('host-b')).toHaveLength(2);
  });

  it('browses files relative to the registered repository path', async () => {
    const list = jest
      .spyOn(RepositoryFiles.prototype, 'list')
      .mockResolvedValue({ path: 'src', entries: [], total: 0, truncated: false });
    const read = jest
      .spyOn(RepositoryFiles.prototype, 'read')
      .mockResolvedValue({ path: 'src/a.bin', kind: 'binary', size: 2 });
    const repo = await service.add('host-b', '/fixture/files');
    expect(await service.listTree(repo.id, 'src')).toMatchObject({ path: 'src' });
    expect(list).toHaveBeenCalledWith('/fixture/files', 'src');
    expect(await service.readFile(repo.id, 'src/a.bin')).toMatchObject({ kind: 'binary' });
    expect(read).toHaveBeenCalledWith('/fixture/files', 'src/a.bin');
    expect(ensureConnected).toHaveBeenCalledWith('host-b');
    await expect(service.listTree('missing', '')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the complete local registry without invoking SSH or Git, even when all hosts hang', async () => {
    const git = jest.spyOn(GitCommands.prototype, 'status');
    ensureConnected.mockImplementation(() => new Promise(() => {}));
    expect(await service.list()).toEqual([]);
    const first = await service.add('host-a', '/fixture/first');
    const second = await service.add('host-b', '/fixture/second');
    await service.pin(second.id, true);
    expect(await service.list()).toEqual([second, first]);
    expect(await service.list('host-a')).toEqual([first]);
    expect(await service.get(first.id)).toEqual(first);
    expect(ensureConnected).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
    await service.delete(first.id);
    expect(await service.list()).toEqual([second]);
  });

  it('coalesces one repository, isolates a timed-out Git command, and allows recovery', async () => {
    jest.useFakeTimers();
    const slow = await service.add('host-a', '/fixture/slow');
    const fast = await service.add('host-b', '/fixture/fast');
    let aborted = false;
    const git = jest
      .spyOn(GitCommands.prototype, 'status')
      .mockImplementation((path, signal) => {
        if (path.endsWith('fast')) return Promise.resolve(status);
        return new Promise((_, reject) =>
          signal!.addEventListener('abort', () => {
            aborted = true;
            reject(signal!.reason);
          }),
        );
      });
    const pending = service.getStatus(slow.id);
    expect(service.getStatus(slow.id)).toBe(pending);
    const failure = expect(pending).rejects.toMatchObject({ status: 504 });
    await expect(service.getStatus(fast.id)).resolves.toEqual(status);
    await jest.advanceTimersByTimeAsync(REPOSITORY_STATUS_TIMEOUT_MS);
    await failure;
    expect(aborted).toBe(true);
    git.mockResolvedValue(status);
    await expect(service.getStatus(slow.id)).resolves.toEqual(status);
    expect(await service.list()).toHaveLength(2);
  });

  it('times out connection setup and never starts Git after the deadline', async () => {
    jest.useFakeTimers();
    const repo = await service.add('host-a', '/fixture/slow');
    const connection = deferred<any>();
    ensureConnected.mockReturnValue(connection.promise);
    const git = jest
      .spyOn(GitCommands.prototype, 'status')
      .mockResolvedValue(status);
    const failure = expect(service.getStatus(repo.id)).rejects.toMatchObject({
      status: 504,
    });
    await jest.advanceTimersByTimeAsync(REPOSITORY_STATUS_TIMEOUT_MS);
    await failure;
    connection.resolve({});
    await Promise.resolve();
    expect(git).not.toHaveBeenCalled();
  });

  it('reports connection and Git errors without converting them to an empty/clean status', async () => {
    const repo = await service.add('host-a', '/fixture/repo');
    ensureConnected.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.getStatus(repo.id)).rejects.toThrow(
      'connection refused',
    );
    jest
      .spyOn(GitCommands.prototype, 'status')
      .mockRejectedValueOnce(new Error('git status failed'));
    await expect(service.getStatus(repo.id)).rejects.toThrow(
      'git status failed',
    );
    await expect(service.list()).resolves.toEqual([repo]);
    await service.delete(repo.id);
    await expect(service.getStatus(repo.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('opens worktrees idempotently across parents, reuses aliases, and isolates connections', async () => {
    const parent = await service.add('host-a', '/fixture/main');
    const secondParent = await service.add('host-a', '/fixture/other');
    const otherHost = await service.add('host-b', '/fixture/feature');
    jest.spyOn(GitWorktrees.prototype, 'resolve').mockResolvedValue('/fixture/feature');
    jest.spyOn(GitWorktrees.prototype, 'canonicalPath').mockImplementation(async (path) => path);
    const [first, second] = await Promise.all([
      service.openWorktree(parent.id, '/fixture/feature'),
      service.openWorktree(secondParent.id, '/fixture/feature'),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(otherHost.id);
    expect(first.path).toBe('/fixture/feature');
    expect((await service.list('host-a')).filter((repo) => repo.path === first.path)).toHaveLength(1);
    const alias = await service.add('host-a', '/alias/detached');
    jest.spyOn(GitWorktrees.prototype, 'resolve').mockResolvedValue('/fixture/detached');
    jest.spyOn(GitWorktrees.prototype, 'canonicalPath').mockImplementation(async (path) =>
      path === alias.path ? '/fixture/detached' : path);
    expect((await service.openWorktree(parent.id, '/fixture/detached')).id).toBe(alias.id);
    expect((await service.list()).length).toBe(5);
  });

  it('never registers a rejected target or a result that arrives after timeout/deletion', async () => {
    const parent = await service.add('host-a', '/fixture/main');
    const resolve = jest.spyOn(GitWorktrees.prototype, 'resolve').mockRejectedValueOnce(new Error('unrelated directory'));
    await expect(service.openWorktree(parent.id, '/elsewhere')).rejects.toThrow('unrelated');
    expect(await service.list()).toHaveLength(1);
    jest.useFakeTimers();
    const delayed = deferred<string>();
    resolve.mockReturnValueOnce(delayed.promise);
    const pending = expect(service.openWorktree(parent.id, '/late')).rejects.toMatchObject({ status: 504 });
    await jest.advanceTimersByTimeAsync(REPOSITORY_STATUS_TIMEOUT_MS);
    await pending;
    delayed.resolve('/late');
    await jest.advanceTimersByTimeAsync(1);
    expect(await service.list()).toHaveLength(1);
    const deleted = deferred<string>();
    resolve.mockReturnValueOnce(deleted.promise);
    const opening = service.openWorktree(parent.id, '/deleted');
    await jest.advanceTimersByTimeAsync(1);
    await service.delete(parent.id);
    deleted.resolve('/deleted');
    await expect(opening).rejects.toMatchObject({ status: 404 });
    expect(await service.list()).toHaveLength(0);
  });

  it('bounds discovery connection setup and leaves the local registry available', async () => {
    jest.useFakeTimers();
    const parent = await service.add('host-a', '/fixture/main');
    const connection = deferred<any>();
    ensureConnected.mockReturnValue(connection.promise);
    const list = jest.spyOn(GitWorktrees.prototype, 'list');
    const failure = expect(service.getWorktrees(parent.id)).rejects.toMatchObject({ status: 504 });
    await jest.advanceTimersByTimeAsync(REPOSITORY_STATUS_TIMEOUT_MS);
    await failure;
    connection.resolve({});
    await Promise.resolve();
    expect(list).not.toHaveBeenCalled();
    expect(await service.list()).toHaveLength(1);
  });

  it('caches verified identity across restart and keeps registry reads offline', async () => {
    const repo = await service.add('host-a', '/fixture/alune');
    jest.spyOn(GitCommands.prototype, 'status').mockResolvedValue(status);
    const kind = jest.spyOn(GitWorktrees.prototype, 'kind').mockResolvedValue('linked');
    expect(await service.getStatus(repo.id)).toEqual({ ...status, worktreeKind: 'linked' });
    service = new RepositoryService(db, { ensureConnected } as unknown as ConnectionService);
    ensureConnected.mockClear();
    expect((await service.list())[0].worktreeKind).toBe('linked');
    expect(ensureConnected).not.toHaveBeenCalled();
    kind.mockRejectedValueOnce(new Error('identity unavailable'));
    expect(await service.getStatus(repo.id)).toEqual(status);
    expect((await service.get(repo.id)).worktreeKind).toBe('linked');
    kind.mockResolvedValueOnce('main');
    await service.getStatus(repo.id);
    expect((await service.get(repo.id)).worktreeKind).toBe('main');
  });

  it('bounds optional identity without failing status or caching late results', async () => {
    jest.useFakeTimers();
    const repo = await service.add('host-a', '/fixture/alune');
    jest.spyOn(GitCommands.prototype, 'status').mockResolvedValue(status);
    const late = deferred<'linked'>();
    let signal: AbortSignal | undefined;
    jest.spyOn(GitWorktrees.prototype, 'kind').mockImplementation((_, value) => {
      signal = value;
      return late.promise;
    });
    const pending = service.getStatus(repo.id);
    await jest.advanceTimersByTimeAsync(1500);
    expect(await pending).toEqual(status);
    expect(signal?.aborted).toBe(true);
    late.resolve('linked');
    await jest.advanceTimersByTimeAsync(1);
    expect((await service.get(repo.id)).worktreeKind).toBeUndefined();
  });
});

describe('blame deadline', () => {
  afterEach(() => jest.useRealTimers());

  it('bounds connection setup and never starts Git after timing out', async () => {
    jest.useFakeTimers();
    const db = new Database(':memory:');
    const service = new RepositoryService(db, {} as any);
    const connection = deferred<any>();
    jest
      .spyOn(service, 'get')
      .mockResolvedValue({ path: '/fixture', source: 'ssh' } as any);
    jest
      .spyOn(service as any, 'connection')
      .mockReturnValue(connection.promise);
    const execGit = jest.fn();
    const pending = expect(
      service.getBlame('repo', { path: 'a.txt' }),
    ).rejects.toMatchObject({ status: 504 });
    await jest.advanceTimersByTimeAsync(15000);
    await pending;
    connection.resolve({ execGit });
    await Promise.resolve();
    expect(execGit).not.toHaveBeenCalled();
    db.close();
  });
});
