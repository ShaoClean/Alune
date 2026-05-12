import { Controller, Get, Post, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ConnectionService } from './connection.service';
import type { SSHConnectionConfig } from '@remote-git/shared';

@Controller('connections')
export class ConnectionController {
  constructor(private readonly connectionService: ConnectionService) {}

  @Post()
  async create(@Body() config: Omit<SSHConnectionConfig, 'id'>) {
    return this.connectionService.create(config);
  }

  @Get()
  async list() {
    const connections = await this.connectionService.list();
    return connections.map(({ password, passphrase, ...rest }) => ({
      ...rest,
      hasAuth: !!(password || passphrase),
    }));
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const { password, passphrase, ...rest } = await this.connectionService.get(id);
    return { ...rest, hasAuth: !!(password || passphrase) };
  }

  @Delete(':id')
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.connectionService.delete(id);
  }

  @Post(':id/test')
  async test(@Param('id', ParseUUIDPipe) id: string) {
    return this.connectionService.test(id);
  }
}