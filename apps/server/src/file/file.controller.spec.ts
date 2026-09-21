import { Test, TestingModule } from '@nestjs/testing';
import { FileController } from './file.controller';
import { FileService } from './file.service';

describe('FileController', () => {
  let controller: FileController;
  const service = {
    listDirectory: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
  };
  const connectionId = 'connection';
  const path = '/repo/中文 file.txt';

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileController],
      providers: [{ provide: FileService, useValue: service }],
    }).compile();

    controller = module.get<FileController>(FileController);
  });

  it('能通过显式依赖创建控制器', () => {
    expect(controller).toBeDefined();
  });

  it('将目录查询参数传给服务并返回目录项', async () => {
    const entries = [{ name: 'file.txt', isDirectory: false, isFile: true }];
    service.listDirectory.mockResolvedValue(entries);

    await expect(controller.listDirectory(connectionId, path)).resolves.toBe(
      entries,
    );
    expect(service.listDirectory).toHaveBeenCalledWith(connectionId, path);
  });

  it.each(['文件内容\n', ''])('将读取内容封装为响应：%j', async (content) => {
    service.readFile.mockResolvedValue(content);

    await expect(controller.readFile(connectionId, path)).resolves.toEqual({
      content,
    });
    expect(service.readFile).toHaveBeenCalledWith(connectionId, path);
  });

  it('将写入内容原样传递并返回服务结果', async () => {
    const content = '第一行\n第二行\n';
    const result = { success: true };
    service.writeFile.mockResolvedValue(result);

    await expect(
      controller.writeFile({ connectionId, path, content }),
    ).resolves.toBe(result);
    expect(service.writeFile).toHaveBeenCalledWith(connectionId, path, content);
  });

  it('不吞掉服务读取错误', async () => {
    const error = new Error('读取失败');
    service.readFile.mockRejectedValue(error);

    await expect(controller.readFile(connectionId, path)).rejects.toBe(error);
  });
});
