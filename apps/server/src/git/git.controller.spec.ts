import { Test, TestingModule } from '@nestjs/testing';
import { GitController } from './git.controller';
import { GitService } from './git.service';

describe('GitController', () => {
  let controller: GitController;
  const service = {
    stage: jest.fn(),
    unstage: jest.fn(),
    commit: jest.fn(),
    push: jest.fn(),
    deleteNewFile: jest.fn(),
  };
  const repositoryId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GitController],
      providers: [{ provide: GitService, useValue: service }],
    }).compile();

    controller = module.get<GitController>(GitController);
  });

  it('能通过显式依赖创建控制器', () => {
    expect(controller).toBeDefined();
  });

  it.each(['stage', 'unstage'] as const)(
    '%s 原样传递仓库和文件列表',
    async (operation) => {
      const files = ["中文 '$HOME' [*].txt"];
      const result = { success: true };
      service[operation].mockResolvedValue(result);

      await expect(
        controller[operation](repositoryId, { files }),
      ).resolves.toBe(result);
      expect(service[operation]).toHaveBeenCalledWith(repositoryId, files);
    },
  );

  it.each([undefined, '详细描述\n第二行'])(
    '提交时保留描述：%j',
    async (description) => {
      const result = { success: true };
      service.commit.mockResolvedValue(result);

      await expect(
        controller.commit(repositoryId, { message: '提交摘要', description }),
      ).resolves.toBe(result);
      expect(service.commit).toHaveBeenCalledWith(
        repositoryId,
        '提交摘要',
        description,
      );
    },
  );

  it('推送时传递远端、分支及强制标记', async () => {
    const result = { success: true };
    service.push.mockResolvedValue(result);

    await expect(
      controller.push(repositoryId, {
        remote: 'origin',
        branch: 'feature/test',
        force: true,
      }),
    ).resolves.toBe(result);
    expect(service.push).toHaveBeenCalledWith(
      repositoryId,
      'origin',
      'feature/test',
      true,
    );
  });

  it('未指定推送参数时交由服务使用默认值', async () => {
    await controller.push(repositoryId, {});
    expect(service.push).toHaveBeenCalledWith(
      repositoryId,
      undefined,
      undefined,
      undefined,
    );
  });

  it('删除预览不传令牌，确认删除传递原始令牌', async () => {
    const path = '新文件.txt';
    const preview = { token: 'confirmation-token' };
    const result = { success: true };
    service.deleteNewFile
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce(result);

    await expect(
      controller.previewNewFileDeletion(repositoryId, { path }),
    ).resolves.toBe(preview);
    expect(service.deleteNewFile).toHaveBeenNthCalledWith(
      1,
      repositoryId,
      path,
      undefined,
      true,
    );
    await expect(
      controller.deleteNewFile(repositoryId, { path, token: preview.token }),
    ).resolves.toBe(result);
    expect(service.deleteNewFile).toHaveBeenNthCalledWith(
      2,
      repositoryId,
      path,
      preview.token,
    );
  });

  it('不吞掉 Git 服务的失败', async () => {
    const error = new Error('推送失败');
    service.push.mockRejectedValue(error);

    await expect(controller.push(repositoryId, {})).rejects.toBe(error);
  });
});
