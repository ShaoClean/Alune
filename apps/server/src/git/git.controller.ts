import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Body,
  Query,
} from '@nestjs/common';
import { GitService } from './git.service';
import type {
  SigningConfig,
  PartialDiffRequest,
  SwitchBranchOptions,
  CreateTagOptions,
  DeleteTagOptions,
  PushTagOptions,
  CheckoutTagOptions,
  RebaseRequest,
  RebaseResolution,
  ConflictBlockChoice,
  ConflictSide,
} from '@alune/shared';

@Controller('repositories')
export class GitController {
  constructor(private readonly gitService: GitService) {}

  @Post(':id/submodules')
  updateSubmodules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { action: 'update' | 'sync' },
  ) {
    return this.gitService.updateSubmodules(id, body?.action);
  }

  @Post(':id/interactive-rebase/preview')
  previewRebase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { base: string },
  ) {
    return this.gitService.previewRebase(id, body?.base);
  }

  @Get(':id/interactive-rebase')
  rebaseState(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.rebaseState(id);
  }

  @Post(':id/interactive-rebase')
  startRebase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RebaseRequest,
  ) {
    return this.gitService.startRebase(id, body);
  }

  @Post(':id/interactive-rebase/control')
  controlRebase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { action: 'continue' | 'skip' | 'abort' },
  ) {
    return this.gitService.controlRebase(id, body?.action);
  }

  @Post(':id/interactive-rebase/conflict')
  rebaseConflict(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { path: string },
  ) {
    return this.gitService.rebaseConflict(id, body?.path);
  }

  @Post(':id/interactive-rebase/resolve')
  resolveRebaseConflict(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RebaseResolution,
  ) {
    return this.gitService.resolveRebaseConflict(id, body);
  }

  @Post(':id/ignore-directory')
  ignoreDirectory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { path: string },
  ) {
    return this.gitService.ignoreDirectory(id, body.path);
  }

  @Post(':id/partial-diff')
  partialDiff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PartialDiffRequest,
  ) {
    return this.gitService.partialDiff(id, body);
  }

  @Post(':id/stage')
  async stage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { files: string[] },
  ) {
    return this.gitService.stage(id, body.files);
  }

  @Post(':id/unstage')
  async unstage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { files: string[] },
  ) {
    return this.gitService.unstage(id, body.files);
  }

  @Post(':id/commit')
  async commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { message: string; description?: string; amend?: string },
  ) {
    return this.gitService.commit(
      id,
      body.message,
      body.description,
      body.amend,
    );
  }

  @Post(':id/push')
  async push(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      remote?: string;
      branch?: string;
      force?: boolean;
      setUpstream?: boolean;
      tags?: boolean;
    },
  ) {
    return body.setUpstream !== undefined || body.tags !== undefined
      ? this.gitService.push(
          id,
          body.remote,
          body.branch,
          body.force,
          body.setUpstream,
          body.tags,
        )
      : this.gitService.push(id, body.remote, body.branch, body.force);
  }

  @Post(':id/pull')
  async pull(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { remote?: string; branch?: string },
  ) {
    return this.gitService.pull(id, body.remote, body.branch);
  }

  @Post(':id/fetch')
  async fetch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { remote?: string },
  ) {
    return this.gitService.fetch(id, body.remote);
  }

  @Get(':id/tags')
  tags(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.tags(id);
  }

  @Get(':id/tags/remote')
  remoteTags(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('remote') remote: string,
  ) {
    return this.gitService.tags(id, remote ?? '');
  }

  @Post(':id/tags')
  createTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateTagOptions,
  ) {
    return this.gitService.createTag(id, body);
  }

  @Post(':id/tags/delete')
  deleteTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeleteTagOptions,
  ) {
    return this.gitService.deleteTag(id, body);
  }

  @Post(':id/tags/push')
  pushTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PushTagOptions,
  ) {
    return this.gitService.pushTag(id, body);
  }

  @Post(':id/tags/checkout')
  checkoutTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CheckoutTagOptions,
  ) {
    return this.gitService.checkoutTag(id, body);
  }

  @Post(':id/branch')
  async createBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; checkout?: boolean },
  ) {
    return this.gitService.createBranch(id, body.name, body.checkout);
  }

  @Post(':id/switch')
  async switchBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string } & SwitchBranchOptions,
  ) {
    return this.gitService.switchBranch(
      id,
      body.name,
      body.localName,
      body.isRemote,
    );
  }

  @Post(':id/branch/delete')
  async deleteBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; force?: boolean },
  ) {
    return this.gitService.deleteBranch(id, body.name, body.force);
  }

  @Post(':id/merge')
  async merge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { branch: string },
  ) {
    return this.gitService.merge(id, body.branch);
  }

  @Post(':id/rebase')
  async rebase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { branch: string },
  ) {
    return this.gitService.rebase(id, body.branch);
  }

  @Post(':id/stash')
  async stash(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { message?: string; includeUntracked?: boolean },
  ) {
    return body.includeUntracked === undefined
      ? this.gitService.stash(id, body.message)
      : this.gitService.stash(id, body.message, body.includeUntracked);
  }

  @Post(':id/stash/pop')
  async stashPop(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { index?: number },
  ) {
    return this.gitService.stashPop(id, body.index);
  }

  @Post(':id/stash/apply')
  async stashApply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { index?: number },
  ) {
    return this.gitService.stashApply(id, body.index);
  }

  @Post(':id/stash/drop')
  async stashDrop(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { index?: number },
  ) {
    return this.gitService.stashDrop(id, body.index);
  }

  @Post(':id/checkout')
  async checkout(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { files: string[] },
  ) {
    return this.gitService.checkout(id, body.files);
  }

  @Post(':id/workspace-file/preview')
  previewWorkspaceFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { path: string },
  ) {
    return this.gitService.previewWorkspaceFile(id, body?.path);
  }

  @Post(':id/workspace-file')
  mutateWorkspaceFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      path: string;
      token: string;
      action: 'delete' | 'rename';
      name?: string;
    },
  ) {
    return this.gitService.mutateWorkspaceFile(
      id,
      body?.path,
      body?.token,
      body?.action,
      body?.name,
    );
  }

  @Post(':id/delete-new-file/preview')
  async previewNewFileDeletion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { path: string },
  ) {
    return this.gitService.deleteNewFile(id, body?.path, undefined, true);
  }

  @Post(':id/discard-changes/preview')
  previewDiscardChanges(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.previewDiscardChanges(id);
  }

  @Post(':id/discard-changes')
  discardChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { token: string; scope: 'tracked' | 'all' },
  ) {
    return this.gitService.discardChanges(id, body?.token, body?.scope);
  }

  @Post(':id/delete-new-file')
  async deleteNewFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { path: string; token: string },
  ) {
    return this.gitService.deleteNewFile(id, body?.path, body?.token);
  }

  @Post(':id/reset')
  async reset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { mode: 'soft' | 'mixed' | 'hard'; commit?: string },
  ) {
    return this.gitService.reset(id, body.mode, body.commit);
  }

  @Post(':id/cherry-pick')
  async cherryPick(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { commits: string[] },
  ) {
    return this.gitService.cherryPick(id, body.commits);
  }

  @Post(':id/revert')
  async revert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { commit: string },
  ) {
    return this.gitService.revert(id, body.commit);
  }

  @Post(':id/conflicts/continue')
  continueOperation(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.continueOperation(id);
  }

  @Post(':id/conflicts/skip')
  skipOperation(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.skipOperation(id);
  }

  @Post(':id/conflicts/abort')
  abortOperation(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.abortOperation(id);
  }

  @Post(':id/conflicts/resolve-file')
  resolveConflictFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { file: string; side: ConflictSide },
  ) {
    return this.gitService.resolveConflictFile(id, body.file, body.side);
  }

  @Post(':id/conflicts/resolve-block')
  resolveConflictBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      file: string;
      index: number;
      choice: ConflictBlockChoice;
      expected: string;
    },
  ) {
    return this.gitService.resolveConflictBlock(
      id,
      body.file,
      body.index,
      body.choice,
      body.expected,
    );
  }

  @Get(':id/operation')
  operation(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.operation(id);
  }

  @Post(':id/operation/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.cancel(id);
  }

  @Post(':id/history/deepen')
  deepen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { remote?: string },
  ) {
    return this.gitService.deepen(id, body.remote);
  }

  @Post(':id/branch/rename')
  renameBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; newName: string },
  ) {
    return this.gitService.renameBranch(id, body.name, body.newName);
  }

  @Post(':id/stash/show')
  stashShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { index?: number },
  ) {
    return this.gitService.stashShow(id, body.index);
  }

  @Post(':id/remotes')
  addRemote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; url: string },
  ) {
    return this.gitService.addRemote(id, body.name, body.url);
  }

  @Get(':id/signing')
  signingConfig(@Param('id', ParseUUIDPipe) id: string) {
    return this.gitService.signingConfig(id);
  }
  @Post(':id/signing')
  saveSigningConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SigningConfig,
  ) {
    return this.gitService.saveSigningConfig(id, body);
  }
  @Post(':id/signatures')
  commitSignatures(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { hashes: string[] },
  ) {
    return this.gitService.commitSignatures(id, body?.hashes);
  }

  @Post(':id/author')
  saveAuthor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name: string; email: string },
  ) {
    return this.gitService.saveAuthor(id, body.name, body.email);
  }

  @Post(':id/worktrees/create')
  createWorktree(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { path: string; branch: string },
  ) {
    return this.gitService.createWorktree(id, body.path, body.branch);
  }

  @Post(':id/worktrees/remove')
  removeWorktree(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { path: string; confirmed: boolean },
  ) {
    return this.gitService.removeWorktree(id, body.path, body.confirmed);
  }
}
