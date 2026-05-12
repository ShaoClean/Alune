import { Controller, Post, Param, ParseUUIDPipe, Body, Query } from '@nestjs/common';
import { GitService } from './git.service';

@Controller('repositories')
export class GitController {
  constructor(private readonly gitService: GitService) {}

  @Post(':id/stage')
  async stage(@Param('id', ParseUUIDPipe) id: string, @Body() body: { files: string[] }) {
    return this.gitService.stage(id, body.files);
  }

  @Post(':id/unstage')
  async unstage(@Param('id', ParseUUIDPipe) id: string, @Body() body: { files: string[] }) {
    return this.gitService.unstage(id, body.files);
  }

  @Post(':id/commit')
  async commit(@Param('id', ParseUUIDPipe) id: string, @Body() body: { message: string; description?: string }) {
    return this.gitService.commit(id, body.message, body.description);
  }

  @Post(':id/push')
  async push(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { remote?: string; branch?: string; force?: boolean },
  ) {
    return this.gitService.push(id, body.remote, body.branch, body.force);
  }

  @Post(':id/pull')
  async pull(@Param('id', ParseUUIDPipe) id: string, @Body() body: { remote?: string; branch?: string }) {
    return this.gitService.pull(id, body.remote, body.branch);
  }

  @Post(':id/fetch')
  async fetch(@Param('id', ParseUUIDPipe) id: string, @Body() body: { remote?: string }) {
    return this.gitService.fetch(id, body.remote);
  }

  @Post(':id/branch')
  async createBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; checkout?: boolean },
  ) {
    return this.gitService.createBranch(id, body.name, body.checkout);
  }

  @Post(':id/switch')
  async switchBranch(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name: string }) {
    return this.gitService.switchBranch(id, body.name);
  }

  @Post(':id/branch/delete')
  async deleteBranch(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name: string; force?: boolean }) {
    return this.gitService.deleteBranch(id, body.name, body.force);
  }

  @Post(':id/merge')
  async merge(@Param('id', ParseUUIDPipe) id: string, @Body() body: { branch: string }) {
    return this.gitService.merge(id, body.branch);
  }

  @Post(':id/rebase')
  async rebase(@Param('id', ParseUUIDPipe) id: string, @Body() body: { branch: string }) {
    return this.gitService.rebase(id, body.branch);
  }

  @Post(':id/stash')
  async stash(@Param('id', ParseUUIDPipe) id: string, @Body() body: { message?: string }) {
    return this.gitService.stash(id, body.message);
  }

  @Post(':id/stash/pop')
  async stashPop(@Param('id', ParseUUIDPipe) id: string, @Body() body: { index?: number }) {
    return this.gitService.stashPop(id, body.index);
  }

  @Post(':id/stash/apply')
  async stashApply(@Param('id', ParseUUIDPipe) id: string, @Body() body: { index?: number }) {
    return this.gitService.stashApply(id, body.index);
  }

  @Post(':id/stash/drop')
  async stashDrop(@Param('id', ParseUUIDPipe) id: string, @Body() body: { index?: number }) {
    return this.gitService.stashDrop(id, body.index);
  }

  @Post(':id/checkout')
  async checkout(@Param('id', ParseUUIDPipe) id: string, @Body() body: { files: string[] }) {
    return this.gitService.checkout(id, body.files);
  }

  @Post(':id/reset')
  async reset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { mode: 'soft' | 'mixed' | 'hard'; commit?: string },
  ) {
    return this.gitService.reset(id, body.mode, body.commit);
  }

  @Post(':id/cherry-pick')
  async cherryPick(@Param('id', ParseUUIDPipe) id: string, @Body() body: { commits: string[] }) {
    return this.gitService.cherryPick(id, body.commits);
  }

  @Post(':id/revert')
  async revert(@Param('id', ParseUUIDPipe) id: string, @Body() body: { commit: string }) {
    return this.gitService.revert(id, body.commit);
  }
}