import { Controller, Get, Post, Delete, Param, ParseUUIDPipe, Query, Body } from '@nestjs/common';
import { RepositoryService } from './repository.service';

@Controller('repositories')
export class RepositoryController {
  constructor(private readonly repoService: RepositoryService) {}

  @Get('scan')
  async scan(@Query('connectionId') connectionId: string, @Query('path') path: string) {
    return this.repoService.scan(connectionId, path);
  }

  @Post()
  async add(@Body() body: { connectionId: string; path: string }) {
    return this.repoService.add(body.connectionId, body.path);
  }

  @Get()
  async list(@Query('connectionId') connectionId?: string) {
    return this.repoService.list(connectionId);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.repoService.get(id);
  }

  @Delete(':id')
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.repoService.delete(id);
  }

  @Post(':id/pin')
  async pin(@Param('id', ParseUUIDPipe) id: string, @Body() body: { pinned: boolean }) {
    return this.repoService.pin(id, body.pinned);
  }

  @Get(':id/status')
  async getStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.repoService.getStatus(id);
  }

  @Get(':id/log')
  async getLog(@Param('id', ParseUUIDPipe) id: string, @Query() query: any) {
    return this.repoService.getLog(id, query);
  }

  @Get(':id/diff')
  async getDiff(@Param('id', ParseUUIDPipe) id: string, @Query() query: any) {
    return this.repoService.getDiff(id, query);
  }

  @Get(':id/branches')
  async getBranches(@Param('id', ParseUUIDPipe) id: string) {
    return this.repoService.getBranches(id);
  }

  @Get(':id/stashes')
  async getStashes(@Param('id', ParseUUIDPipe) id: string) {
    return this.repoService.getStashes(id);
  }

  @Get(':id/remotes')
  async getRemotes(@Param('id', ParseUUIDPipe) id: string) {
    return this.repoService.getRemotes(id);
  }
}