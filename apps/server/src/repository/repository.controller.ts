import {
  BadRequestException,
  ConflictException,
  HttpException,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseUUIDPipe,
  Query,
  Body,
} from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { GitLogChangedError, GitLogOptionsError } from '@remote-git/ssh-client';
import type { DiffOptions } from '@remote-git/shared';

@Controller('repositories')
export class RepositoryController {
  constructor(private readonly repoService: RepositoryService) {}

  @Get('scan')
  async scan(
    @Query('connectionId') connectionId: string,
    @Query('path') path: string,
  ) {
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
  async pin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { pinned: boolean },
  ) {
    return this.repoService.pin(id, body.pinned);
  }

  @Get(':id/status')
  async getStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.repoService.getStatus(id);
  }

  @Get(':id/log')
  async getLog(@Param('id', ParseUUIDPipe) id: string, @Query() query: any) {
    try {
      return await this.repoService.getLog(id, query);
    } catch (error) {
      if (error instanceof GitLogChangedError)
        throw new ConflictException({
          code: 'HISTORY_CHANGED',
          message: error.message,
        });
      if (error instanceof GitLogOptionsError)
        throw new BadRequestException(error.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        error instanceof Error ? error.message : '无法读取提交历史',
      );
    }
  }

  @Get(':id/commit-files')
  async getCommitFiles(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('commit') commit?: string,
    @Query('parentCommit') parentCommit?: string,
  ) {
    if (!commit) throw new BadRequestException('commit is required');
    return this.repoService.getCommitFiles(id, commit, parentCommit);
  }

  @Get(':id/diff')
  async getDiff(@Param('id', ParseUUIDPipe) id: string, @Query() query: any) {
    const options: DiffOptions = {
      file: typeof query.file === 'string' ? query.file : undefined,
      staged:
        query.staged === true ||
        query.staged === 'true' ||
        query.staged === '1',
      commit: typeof query.commit === 'string' ? query.commit : undefined,
      parentCommit:
        typeof query.parentCommit === 'string' ? query.parentCommit : undefined,
    };
    try {
      return await this.repoService.getDiff(id, options);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Preserve actionable read/limit feedback instead of Nest's generic 500 message.
      throw new BadRequestException(
        error instanceof Error ? error.message : '无法读取差异',
      );
    }
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
