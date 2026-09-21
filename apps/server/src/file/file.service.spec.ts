import { Test, TestingModule } from '@nestjs/testing';
import { FileService } from './file.service';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';

describe('FileService', () => {
  let service: FileService;
  const connection = {
    readDir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
  };
  const connectionService = { ensureConnected: jest.fn() };
  const connectionId = 'connection';
  const path = '/repo/中文 file.txt';

  beforeEach(async () => {
    jest.resetAllMocks();
    connectionService.ensureConnected.mockResolvedValue(connection);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        { provide: ConnectionService, useValue: connectionService },
        { provide: RepositoryService, useValue: {} },
      ],
    }).compile();

    service = module.get<FileService>(FileService);
  });

  it('能通过显式依赖创建服务', () => {
    expect(service).toBeDefined();
  });

  it('连接后读取目录并区分目录、文件和符号链接', async () => {
    const entries = [
      { name: '目录', longname: 'drwxr-xr-x directory' },
      { name: 'file.txt', longname: '-rw-r--r-- file' },
      { name: 'link', longname: 'lrwxrwxrwx link -> file' },
    ];
    connection.readDir.mockResolvedValue(entries);

    await expect(service.listDirectory(connectionId, path)).resolves.toEqual([
      { ...entries[0], isDirectory: true, isFile: false },
      { ...entries[1], isDirectory: false, isFile: true },
      { ...entries[2], isDirectory: false, isFile: false },
    ]);
    expect(connectionService.ensureConnected).toHaveBeenCalledWith(
      connectionId,
    );
    expect(connection.readDir).toHaveBeenCalledWith(path);
  });

  it('保留空目录结果', async () => {
    connection.readDir.mockResolvedValue([]);
    await expect(service.listDirectory(connectionId, path)).resolves.toEqual(
      [],
    );
  });

  it.each(['文件内容\n', ''])('连接后原样返回文件内容：%j', async (content) => {
    connection.readFile.mockResolvedValue(content);

    await expect(service.readFile(connectionId, path)).resolves.toBe(content);
    expect(connectionService.ensureConnected).toHaveBeenCalledWith(
      connectionId,
    );
    expect(connection.readFile).toHaveBeenCalledWith(path);
  });

  it('连接后写入原始内容并返回成功', async () => {
    const content = '第一行\n第二行\n';
    connection.writeFile.mockResolvedValue(undefined);

    await expect(
      service.writeFile(connectionId, path, content),
    ).resolves.toEqual({ success: true });
    expect(connectionService.ensureConnected).toHaveBeenCalledWith(
      connectionId,
    );
    expect(connection.writeFile).toHaveBeenCalledWith(path, content);
  });

  it.each(['listDirectory', 'readFile', 'writeFile'] as const)(
    '%s 在连接失败时不进行文件操作',
    async (operation) => {
      const error = new Error('连接失败');
      connectionService.ensureConnected.mockRejectedValue(error);

      await expect(service[operation](connectionId, path, '')).rejects.toBe(
        error,
      );
      expect(connection.readDir).not.toHaveBeenCalled();
      expect(connection.readFile).not.toHaveBeenCalled();
      expect(connection.writeFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['listDirectory', 'readDir'],
    ['readFile', 'readFile'],
    ['writeFile', 'writeFile'],
  ] as const)(
    '%s 传播远端操作失败而不是返回成功',
    async (operation, remoteOperation) => {
      const error = new Error('远端操作失败');
      connection[remoteOperation].mockRejectedValue(error);

      await expect(service[operation](connectionId, path, '')).rejects.toBe(
        error,
      );
    },
  );
});
