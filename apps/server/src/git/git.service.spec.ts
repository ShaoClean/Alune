import { GitService } from './git.service';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';
import { GitCommands } from '@alune/ssh-client';

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
