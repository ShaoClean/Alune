import { RepositoryController } from './repository.controller';
import { RepositoryService } from './repository.service';

describe('RepositoryController', () => {
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
