import { GitLogChangedError, GitLogOptionsError } from '@remote-git/ssh-client';
import { RepositoryController } from './repository.controller';
import { RepositoryService } from './repository.service';

describe('RepositoryController', () => {
  it('validates worktree selections and preserves useful status/open failures', async () => {
    const openWorktree = jest.fn().mockResolvedValue({ id: 'target' });
    const getWorktrees = jest.fn().mockResolvedValue([]);
    const getStatus = jest.fn().mockRejectedValue(new Error('directory missing'));
    const controller = new RepositoryController({ openWorktree, getWorktrees, getStatus } as unknown as RepositoryService);
    for (const path of [undefined, 3, '', 'bad\0path'])
      await expect(controller.openWorktree('fixture', { path })).rejects.toMatchObject({ status: 400 });
    expect(openWorktree).not.toHaveBeenCalled();
    expect(await controller.openWorktree('fixture', { path: ' /path\n' })).toEqual({ id: 'target' });
    expect(openWorktree).toHaveBeenCalledWith('fixture', ' /path\n');
    expect(await controller.getWorktrees('fixture')).toEqual([]);
    openWorktree.mockRejectedValue(new Error('permission denied'));
    await expect(controller.openWorktree('fixture', { path: '/path' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('permission denied') });
    await expect(controller.getStatus('fixture')).rejects.toMatchObject({ status: 400, message: 'directory missing' });
  });
  it('separates staged and unstaged previews and forwards actionable failures', async () => {
    const getDiff = jest.fn().mockResolvedValue('patch');
    const controller = new RepositoryController({
      getDiff,
    } as unknown as RepositoryService);
    await controller.getDiff('fixture', { file: '中文 file', staged: 'false' });
    expect(getDiff).toHaveBeenLastCalledWith(
      'fixture',
      expect.objectContaining({ file: '中文 file', staged: false }),
    );
    await controller.getDiff('fixture', { file: '中文 file', staged: 'true' });
    expect(getDiff).toHaveBeenLastCalledWith(
      'fixture',
      expect.objectContaining({ staged: true }),
    );
    getDiff.mockRejectedValueOnce(new Error('文件已不存在，请刷新仓库状态。'));
    await expect(
      controller.getDiff('fixture', { file: 'gone' }),
    ).rejects.toMatchObject({
      status: 400,
      message: '文件已不存在，请刷新仓库状态。',
    });
  });

  it('keeps registration and remote state on separate endpoints', async () => {
    const list = jest.fn().mockResolvedValue([{ id: 'fixture', name: 'repo' }]);
    const getStatus = jest
      .fn()
      .mockResolvedValue({ branch: 'main', files: [], ahead: 0, behind: 0 });
    const controller = new RepositoryController({
      list,
      getStatus,
    } as unknown as RepositoryService);
    expect(await controller.list()).toEqual([{ id: 'fixture', name: 'repo' }]);
    expect(list).toHaveBeenCalledWith(undefined);
    expect(getStatus).not.toHaveBeenCalled();
    await controller.getStatus('fixture');
    expect(getStatus).toHaveBeenCalledWith('fixture');
  });
});

describe('RepositoryController history pages', () => {
  it('forwards paging metadata, and exposes history changes separately from retryable failures', async () => {
    const page = {
      commits: [],
      hasMore: false,
      nextSkip: 50,
      revision: 'revision',
      shallow: false,
    };
    const getLog = jest.fn().mockResolvedValue(page);
    const controller = new RepositoryController({
      getLog,
    } as unknown as RepositoryService);
    const options = { count: '50', skip: '50', revision: 'revision' };
    expect(await controller.getLog('fixture', options)).toEqual(page);
    expect(getLog).toHaveBeenCalledWith('fixture', options);
    getLog.mockRejectedValueOnce(new GitLogChangedError());
    await expect(controller.getLog('fixture', options)).rejects.toMatchObject({
      status: 409,
      response: { code: 'HISTORY_CHANGED' },
    });
    getLog.mockRejectedValueOnce(new GitLogOptionsError('无效分页'));
    await expect(
      controller.getLog('fixture', { count: '-1' }),
    ).rejects.toMatchObject({ status: 400, message: '无效分页' });
    getLog.mockRejectedValueOnce(new Error('SSH 连接中断'));
    await expect(controller.getLog('fixture', options)).rejects.toMatchObject({
      status: 400,
      message: 'SSH 连接中断',
    });
  });
});
