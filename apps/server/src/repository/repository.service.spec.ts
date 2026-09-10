import Database from 'better-sqlite3';
import { GitCommands } from '@remote-git/ssh-client';
import { REPOSITORY_STATUS_TIMEOUT_MS } from '@remote-git/shared';
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
});
