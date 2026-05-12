import { Injectable } from '@nestjs/common';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';

@Injectable()
export class FileService {
  constructor(
    private connectionService: ConnectionService,
    private repoService: RepositoryService,
  ) {}

  async listDirectory(connectionId: string, remotePath: string) {
    const conn = await this.connectionService.ensureConnected(connectionId);
    const entries = await conn.readDir(remotePath);
    return entries.map((entry) => ({
      name: entry.name,
      longname: entry.longname,
      isDirectory: entry.longname.startsWith('d'),
      isFile: !entry.longname.startsWith('d') && !entry.longname.startsWith('l'),
    }));
  }

  async readFile(connectionId: string, remotePath: string) {
    const conn = await this.connectionService.ensureConnected(connectionId);
    return conn.readFile(remotePath);
  }

  async writeFile(connectionId: string, remotePath: string, content: string) {
    const conn = await this.connectionService.ensureConnected(connectionId);
    await conn.writeFile(remotePath, content);
    return { success: true };
  }
}