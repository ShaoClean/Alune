import { GitService } from './git.service';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';
import { GitCommands, InteractiveRebase } from '@alune/ssh-client';

describe('GitService index operations', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['stage', 'unstage'] as const)(
    'uses literal file handling for %s',
    async (action) => {
      const changeIndex = jest
        .spyOn(GitCommands.prototype, action)
        .mockResolvedValue();
      const service = new GitService(
        { ensureConnected: async () => ({}) } as unknown as ConnectionService,
        {
          get: async () => ({ path: '/fixture/repo', connectionId: 'host' }),
        } as unknown as RepositoryService,
      );
      const files = ["中文 '$HOME' [*].txt"];
      await expect(service[action]('repo', files)).resolves.toEqual({
        success: true,
      });
      expect(changeIndex).toHaveBeenCalledWith('/fixture/repo', files);
    },
  );
});

describe('Git operation lifecycle', () => {
  it('cancels during pending SSH setup, releases the write guard and never runs a late command', async () => {
    let connected!: (connection: any) => void;
    const execute = jest.fn();
    const service = new GitService(
      {
        ensureConnected: () =>
          new Promise((resolve) => {
            connected = resolve;
          }),
      } as unknown as ConnectionService,
      {
        get: async () => ({ path: '/fixture/repo', connectionId: 'host' }),
      } as unknown as RepositoryService,
    );
    const first = service.fetch('repo');
    const failure = expect(first).rejects.toThrow('已取消');
    while (!connected) await new Promise((resolve) => setImmediate(resolve));
    await expect(service.push('repo')).rejects.toMatchObject({ status: 409 });
    expect(service.operation('repo')?.kind).toBe('fetch');
    service.cancel('repo');
    await failure;
    expect(service.operation('repo')).toBeNull();
    connected({ execCommand: execute });
    await new Promise((resolve) => setImmediate(resolve));
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('LFS transfer progress', () => {
  it('reports both output streams, keeps failure details, and releases the operation guard', async () => {
    jest
      .spyOn(InteractiveRebase.prototype, 'state')
      .mockResolvedValue({ managed: false } as any);
    let finish!: (result: any) => void;
    let output: any;
    const connection = {
      execCommand: jest.fn(),
      withSftp: jest.fn(),
      execGit: jest.fn(async (_path, args, _signal, options) => {
        if (args[0] !== 'push') return { exitCode: 0, stdout: '', stderr: '' };
        output = options;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }),
    };
    const service = new GitService(
      {
        ensureConnected: async () => connection,
      } as unknown as ConnectionService,
      {
        get: async () => ({ path: '/fixture/repo', connectionId: 'host' }),
      } as unknown as RepositoryService,
    );
    const pending = service.push('repo');
    const failed = expect(pending).rejects.toThrow('LFS upload failed: 403');
    for (let tries = 0; !finish && tries < 100; tries++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(finish).toBeDefined();
    expect(output.environment.GIT_LFS_FORCE_PROGRESS).toBe('1');
    output.onStdout('Uploading LFS objects: 50% (1/2)\r');
    expect(service.operation('repo')?.progress).toContain('50%');
    output.onStderr('LFS upload failed: 403\n');
    expect(service.operation('repo')?.progress).toContain('403');
    finish({ exitCode: 1, stdout: '', stderr: 'LFS upload failed: 403' });
    await failed;
    expect(service.operation('repo')).toBeNull();
    jest.restoreAllMocks();
  });
});
