import { Injectable, HttpException, ConflictException } from '@nestjs/common';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';
import {
  GitCommands,
  NewFileDeletion,
  NewFileDeletionError,
  validateNewFilePath,
} from '@alune/ssh-client';

@Injectable()
export class GitService {
  private readonly newFileDeletions = new Set<string>();
  constructor(
    private connectionService: ConnectionService,
    private repoService: RepositoryService,
  ) {}

  private async getGit(id: string): Promise<GitCommands> {
    const repo = await this.repoService.get(id);
    const conn = await this.connectionService.ensureConnected(repo.connectionId);
    return new GitCommands(conn);
  }

  async deleteNewFile(id: string, path: string, token?: string, preview = false) {
    let key: string | undefined;
    try {
      validateNewFilePath(path);
      const repo = await this.repoService.get(id);
      const target = `${repo.connectionId}\0${repo.path}`;
      if (this.newFileDeletions.has(target)) {
        throw new ConflictException('此仓库正在删除文件，请等待操作完成。');
      }
      if (!preview) {
        key = target;
        this.newFileDeletions.add(key);
      }
      const connection = await this.connectionService.ensureConnected(repo.connectionId);
      const deletion = new NewFileDeletion(connection);
      return preview
        ? await deletion.preview(repo.path, path)
        : await deletion.delete(repo.path, path, token!);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : '远端文件操作失败，请刷新后重试。',
        error instanceof NewFileDeletionError ? error.statusCode : 502,
      );
    } finally {
      if (key) this.newFileDeletions.delete(key);
    }
  }

  async stage(id: string, files: string[]) {
    const git = await this.getGit(id);
    await git.stage((await this.repoService.get(id)).path, files);
    return { success: true };
  }

  async unstage(id: string, files: string[]) {
    const git = await this.getGit(id);
    await git.unstage((await this.repoService.get(id)).path, files);
    return { success: true };
  }

  async commit(id: string, message: string, description?: string) {
    const git = await this.getGit(id);
    const fullMessage = description ? `${message}\n\n${description}` : message;
    const result = await git.commit(
      (await this.repoService.get(id)).path,
      fullMessage,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true, stdout: result.stdout };
  }

  async push(id: string, remote?: string, branch?: string, force?: boolean) {
    const git = await this.getGit(id);
    let cmd = 'push';
    if (remote) cmd += ` ${remote}`;
    if (branch) cmd += ` ${branch}`;
    if (force) cmd += ' --force';
    const result = await git.execute((await this.repoService.get(id)).path, cmd);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true, stdout: result.stdout };
  }

  async pull(id: string, remote?: string, branch?: string) {
    const git = await this.getGit(id);
    let cmd = 'pull';
    if (remote) cmd += ` ${remote}`;
    if (branch) cmd += ` ${branch}`;
    const result = await git.execute((await this.repoService.get(id)).path, cmd);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true, stdout: result.stdout };
  }

  async fetch(id: string, remote?: string) {
    const git = await this.getGit(id);
    let cmd = 'fetch';
    if (remote) cmd += ` ${remote}`;
    const result = await git.execute((await this.repoService.get(id)).path, cmd);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true, stdout: result.stdout };
  }

  async createBranch(id: string, name: string, checkout?: boolean) {
    const git = await this.getGit(id);
    const repo = await this.repoService.get(id);
    let cmd = checkout ? `checkout -b "${name}"` : `branch "${name}"`;
    const result = await git.execute(repo.path, cmd);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true };
  }

  async switchBranch(id: string, name: string) {
    const git = await this.getGit(id);
    const result = await git.execute(
      (await this.repoService.get(id)).path,
      `checkout "${name}"`,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true };
  }

  async deleteBranch(id: string, name: string, force?: boolean) {
    const git = await this.getGit(id);
    const flag = force ? '-D' : '-d';
    const result = await git.execute(
      (await this.repoService.get(id)).path,
      `branch ${flag} "${name}"`,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true };
  }

  async merge(id: string, branch: string) {
    const git = await this.getGit(id);
    const result = await git.execute(
      (await this.repoService.get(id)).path,
      `merge "${branch}"`,
    );
    return { success: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }

  async rebase(id: string, branch: string) {
    const git = await this.getGit(id);
    const result = await git.execute(
      (await this.repoService.get(id)).path,
      `rebase "${branch}"`,
    );
    return { success: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }

  async stash(id: string, message?: string) {
    const git = await this.getGit(id);
    let cmd = 'stash';
    if (message) cmd += ` save ${JSON.stringify(message)}`;
    else cmd += ' push';
    const result = await git.execute((await this.repoService.get(id)).path, cmd);
    if (result.exitCode !== 0 && result.stderr) throw new Error(result.stderr);
    return { success: true, stdout: result.stdout };
  }

  async stashPop(id: string, index?: number) {
    const git = await this.getGit(id);
    let cmd = 'stash pop';
    if (index !== undefined) cmd += ` "stash@{${index}}"`;
    const result = await git.execute((await this.repoService.get(id)).path, cmd);
    return { success: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }

  async stashApply(id: string, index?: number) {
    const git = await this.getGit(id);
    let cmd = 'stash apply';
    if (index !== undefined) cmd += ` "stash@{${index}}"`;
    const result = await git.execute((await this.repoService.get(id)).path, cmd);
    return { success: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }

  async stashDrop(id: string, index?: number) {
    const git = await this.getGit(id);
    let cmd = 'stash drop';
    if (index !== undefined) cmd += ` "stash@{${index}}"`;
    const result = await git.execute((await this.repoService.get(id)).path, cmd);
    return { success: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }

  async checkout(id: string, files: string[]) {
    const git = await this.getGit(id);
    const result = await git.execute(
      (await this.repoService.get(id)).path,
      `checkout -- ${files.map((f) => `"${f}"`).join(' ')}`,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true };
  }

  async reset(id: string, mode: 'soft' | 'mixed' | 'hard', commit?: string) {
    const git = await this.getGit(id);
    const flag = mode === 'soft' ? '--soft' : mode === 'hard' ? '--hard' : '--mixed';
    let cmd = `reset ${flag}`;
    if (commit) cmd += ` ${commit}`;
    const result = await git.execute((await this.repoService.get(id)).path, cmd);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return { success: true };
  }

  async cherryPick(id: string, commits: string[]) {
    const git = await this.getGit(id);
    const result = await git.execute(
      (await this.repoService.get(id)).path,
      `cherry-pick ${commits.join(' ')}`,
    );
    return { success: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }

  async revert(id: string, commit: string) {
    const git = await this.getGit(id);
    const result = await git.execute(
      (await this.repoService.get(id)).path,
      `revert ${commit}`,
    );
    return { success: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }
}
