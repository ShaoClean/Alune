import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { FileService } from './file.service';

@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('list')
  async listDirectory(@Query('connectionId') connectionId: string, @Query('path') path: string) {
    return this.fileService.listDirectory(connectionId, path);
  }

  @Get('read')
  async readFile(@Query('connectionId') connectionId: string, @Query('path') path: string) {
    const content = await this.fileService.readFile(connectionId, path);
    return { content };
  }

  @Post('write')
  async writeFile(@Body() body: { connectionId: string; path: string; content: string }) {
    return this.fileService.writeFile(body.connectionId, body.path, body.content);
  }
}