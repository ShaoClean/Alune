import { GitService } from './git.service';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';
import { GitCommands } from '@remote-git/ssh-client';

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
