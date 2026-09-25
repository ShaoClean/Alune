import {
  DiffImageAbsentError,
  GitLogChangedError,
  GitLogOptionsError,
  RepositoryFileError,
} from '@alune/ssh-client';
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

  it('requires an explicit image side and separates a missing version from a failure', async () => {
    const image = { path: 'a.png', side: 'after', mediaType: 'image/png', byteLength: 3, content: 'AAA' };
    const getDiffImage = jest.fn().mockResolvedValue(image);
    const controller = new RepositoryController({
      getDiffImage,
    } as unknown as RepositoryService);
    for (const query of [{}, { file: 'a.png' }, { file: 'a.png', side: 'left' }, { side: 'after' }])
      await expect(controller.getDiffImage('fixture', query)).rejects.toMatchObject({ status: 400 });
    expect(getDiffImage).not.toHaveBeenCalled();

    expect(
      await controller.getDiffImage('fixture', { file: '中文 a.png', side: 'before', staged: 'true' }),
    ).toEqual(image);
    expect(getDiffImage).toHaveBeenLastCalledWith(
      'fixture',
      expect.objectContaining({ file: '中文 a.png', side: 'before', staged: true }),
    );
    await controller.getDiffImage('fixture', { file: 'a.png', side: 'after', commit: 'c' });
    expect(getDiffImage).toHaveBeenLastCalledWith(
      'fixture',
      expect.objectContaining({ commit: 'c', staged: false }),
    );

    // An absent side is a normal added/deleted case, so the page can tell them apart.
    getDiffImage.mockRejectedValueOnce(new DiffImageAbsentError());
    await expect(
      controller.getDiffImage('fixture', { file: 'a.png', side: 'before' }),
    ).rejects.toMatchObject({ status: 404 });
    getDiffImage.mockRejectedValueOnce(new Error('图片超出预览限制（5 MiB）'));
    await expect(
      controller.getDiffImage('fixture', { file: 'a.png', side: 'after' }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('5 MiB') });
  });

  it('browses the tree read-only and keeps missing, forbidden and failed paths distinct', async () => {
    const listing = { path: '', entries: [], total: 0, truncated: false };
    const preview = { path: 'a.txt', kind: 'text', size: 1, encoding: 'utf-8', content: 'a' };
    const listTree = jest.fn().mockResolvedValue(listing);
    const readFile = jest.fn().mockResolvedValue(preview);
    const controller = new RepositoryController({
      listTree,
      readFile,
    } as unknown as RepositoryService);
    expect(await controller.getTree('fixture')).toEqual(listing);
    expect(listTree).toHaveBeenLastCalledWith('fixture', '');
    await controller.getTree('fixture', '源码/子 目录');
    expect(listTree).toHaveBeenLastCalledWith('fixture', '源码/子 目录');
    await expect(controller.getTree('fixture', ['a', 'b'])).rejects.toMatchObject({ status: 400 });
    for (const path of [undefined, '', ['a.txt']])
      await expect(controller.getFile('fixture', path)).rejects.toMatchObject({ status: 400 });
    expect(readFile).not.toHaveBeenCalled();
    expect(await controller.getFile('fixture', 'a.txt')).toEqual(preview);

    listTree.mockRejectedValueOnce(new RepositoryFileError('目录不存在', 404));
    await expect(controller.getTree('fixture', 'gone')).rejects.toMatchObject({ status: 404 });
    readFile.mockRejectedValueOnce(new RepositoryFileError('没有读取此文件的权限。', 403));
    await expect(controller.getFile('fixture', 'secret')).rejects.toMatchObject({
      status: 403,
      message: '没有读取此文件的权限。',
    });
    readFile.mockRejectedValueOnce(new RepositoryFileError('“link/a”经过符号链接'));
    await expect(controller.getFile('fixture', 'link/a')).rejects.toMatchObject({ status: 400 });
    listTree.mockRejectedValueOnce(new Error('远端文件操作超时'));
    await expect(controller.getTree('fixture', 'slow')).rejects.toMatchObject({
      status: 400,
      message: '远端文件操作超时',
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
