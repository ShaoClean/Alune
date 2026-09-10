import { RepositoryController } from './repository.controller';
import { RepositoryService } from './repository.service';

describe('RepositoryController', () => {
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
