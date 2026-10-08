import Database from 'better-sqlite3';
import { GitLfs, RepositoryFiles } from '@alune/ssh-client';
import { LFS_STATUS_TIMEOUT_MS } from '@alune/shared';
import type { LfsStatus } from '@alune/shared';
import { RepositoryService } from './repository.service';
import { ConnectionService } from '../connection/connection.service';

const status: LfsStatus = {
  used: false,
  installed: true,
  version: 'git-lfs/test',
};

describe('LFS status request lifecycle', () => {
  let db: Database.Database;
  let service: RepositoryService;
  let ensureConnected: jest.Mock;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(
      "CREATE TABLE connections (id TEXT PRIMARY KEY); INSERT INTO connections VALUES ('host')",
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

  it('shares in-flight scans per repository, leaves previews independent, and rescans after success', async () => {
    const first = await service.add('host', '/first');
    const second = await service.add('host', '/second');
    let finish!: (value: LfsStatus) => void;
    const pending = new Promise<LfsStatus>((resolve) => {
      finish = resolve;
    });
    const scan = jest
      .spyOn(GitLfs.prototype, 'status')
      .mockImplementation((path) =>
        path === '/first' ? pending : Promise.resolve(status),
      );
    jest.spyOn(RepositoryFiles.prototype, 'read').mockResolvedValue({
      path: 'index.ts',
      kind: 'text',
      size: 2,
      encoding: 'utf-8',
      content: 'ok',
    });
    const request = service.getLfsStatus(first.id);
    expect(service.getLfsStatus(first.id)).toBe(request);
    await expect(service.getLfsStatus(second.id)).resolves.toEqual(status);
    await expect(service.readFile(first.id, 'index.ts')).resolves.toMatchObject(
      { content: 'ok' },
    );
    expect(scan).toHaveBeenCalledTimes(2);
    finish(status);
    await expect(request).resolves.toEqual(status);
    await expect(service.getLfsStatus(first.id)).resolves.toEqual(status);
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it('releases failed requests so a retry can succeed', async () => {
    const repo = await service.add('host', '/repo');
    const scan = jest
      .spyOn(GitLfs.prototype, 'status')
      .mockRejectedValueOnce(new Error('attribute read failed'))
      .mockResolvedValue(status);
    const request = service.getLfsStatus(repo.id);
    expect(service.getLfsStatus(repo.id)).toBe(request);
    await expect(request).rejects.toThrow('attribute read failed');
    await expect(service.getLfsStatus(repo.id)).resolves.toEqual(status);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('bounds connection setup, clears the shared request, and never starts late Git work', async () => {
    jest.useFakeTimers();
    const repo = await service.add('host', '/repo');
    let connect!: (connection: object) => void;
    ensureConnected.mockReturnValueOnce(
      new Promise((resolve) => {
        connect = resolve;
      }),
    );
    const scan = jest
      .spyOn(GitLfs.prototype, 'status')
      .mockResolvedValue(status);
    const request = service.getLfsStatus(repo.id);
    expect(service.getLfsStatus(repo.id)).toBe(request);
    const failure = expect(request).rejects.toMatchObject({
      status: 504,
      message: 'LFS 检测超时，请重试',
    });
    await jest.advanceTimersByTimeAsync(LFS_STATUS_TIMEOUT_MS);
    await failure;
    connect({});
    await jest.advanceTimersByTimeAsync(1);
    expect(scan).not.toHaveBeenCalled();
    await expect(service.getLfsStatus(repo.id)).resolves.toEqual(status);
  });

  it('aborts a running scan at the shared deadline and allows retry', async () => {
    jest.useFakeTimers();
    const repo = await service.add('host', '/repo');
    let signal: AbortSignal | undefined;
    ensureConnected.mockResolvedValue({
      execCommand: (
        _command: string,
        _cwd: string,
        currentSignal: AbortSignal,
      ) => {
        signal = currentSignal;
        return new Promise((_, reject) => {
          currentSignal.addEventListener(
            'abort',
            () => reject(currentSignal.reason),
            { once: true },
          );
        });
      },
    });
    const failure = expect(service.getLfsStatus(repo.id)).rejects.toMatchObject(
      { status: 504 },
    );
    await jest.advanceTimersByTimeAsync(LFS_STATUS_TIMEOUT_MS);
    await failure;
    expect(signal?.aborted).toBe(true);
    jest.spyOn(GitLfs.prototype, 'status').mockResolvedValue(status);
    await expect(service.getLfsStatus(repo.id)).resolves.toEqual(status);
  });
});
