import { promisify } from 'node:util';
import type { SubmoduleInfo } from '@alune/shared';
import { runGit, type RepositoryTransport } from './repository-transport';
import { joinRepositoryPath } from './repository-path';
import { resolveRepositoryDirectory, validateRepositoryPath } from './repository-files';

export class GitSubmodules {
  constructor(private readonly connection: RepositoryTransport) {}

  async list(repoPath: string): Promise<SubmoduleInfo[]> {
    const items: SubmoduleInfo[] = [];
    const visit = async (root: string, prefix: string, depth: number) => {
      if (depth > 32 || items.length > 1000) throw new Error('子模块层级或数量超出读取限制。');
      const index = await runGit(this.connection, root, ['ls-files', '--stage', '-z']);
      if (index.exitCode !== 0) throw new Error(index.stderr || '无法读取子模块。');
      const links = new Map<string, { hash: string; conflict: boolean }>();
      for (const row of index.stdout.split('\0')) {
        const match = row.match(/^160000 ([a-f0-9]+) ([0-3])\t([\s\S]+)$/);
        if (!match) continue;
        links.set(match[3], { hash: match[1], conflict: match[2] !== '0' });
      }
      for (const [path, link] of links) {
        if (items.length >= 1000) throw new Error('子模块数量超出读取限制。');
        validateRepositoryPath(root, path);
        const absolute = joinRepositoryPath(root, path);
        const initialized = await this.connection.withSftp(async (sftp) => {
          try {
            await resolveRepositoryDirectory(sftp, root, path, path);
            const stat = await promisify(sftp.lstat.bind(sftp))(
              joinRepositoryPath(absolute, '.git'),
            );
            return stat.isFile() || stat.isDirectory();
          } catch (error) {
            const code = (error as { code?: number | string }).code;
            if (code === 'ENOENT' || code === 2) return false;
            throw error;
          }
        });
        let currentCommit: string | null = null;
        let dirty = false;
        if (initialized) {
          const head = await runGit(this.connection, absolute, ['rev-parse', '--verify', 'HEAD']);
          if (head.exitCode !== 0) throw new Error(head.stderr || `无法读取子模块 ${path}。`);
          currentCommit = head.stdout.trim();
          const status = await runGit(this.connection, absolute, [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=normal',
            '--ignore-submodules=none',
          ]);
          if (status.exitCode !== 0) throw new Error(status.stderr || '无法读取子模块状态。');
          dirty = !!status.stdout;
        }
        const fullPath = prefix ? `${prefix}/${path}` : path;
        items.push({
          path: fullPath,
          recordedCommit: link.hash,
          currentCommit,
          initialized,
          dirty,
          status: link.conflict
            ? 'conflict'
            : !initialized
              ? 'uninitialized'
              : currentCommit !== link.hash
                ? 'changed'
                : 'current',
        });
        if (initialized && !link.conflict) await visit(absolute, fullPath, depth + 1);
      }
    };
    await visit(repoPath, '', 0);
    return items;
  }

  async update(repoPath: string, action: 'update' | 'sync') {
    if (action !== 'update' && action !== 'sync') throw new Error('无效的子模块操作。');
    // No force/reset: Git retains locally modified submodules and explains conflicts.
    const args =
      action === 'sync'
        ? ['submodule', 'sync', '--recursive']
        : ['submodule', 'update', '--init', '--recursive'];
    const result = await runGit(this.connection, repoPath, args);
    if (result.exitCode !== 0)
      throw new Error(result.stderr || result.stdout || '子模块操作失败。');
    return { success: true, stdout: result.stdout };
  }

  async resolve(repoPath: string, path: string): Promise<string> {
    validateRepositoryPath(repoPath, path);
    const item = (await this.list(repoPath)).find((item) => item.path === path);
    if (!item?.initialized) throw new Error('请先初始化所选子模块。');
    return this.connection.withSftp((sftp) =>
      resolveRepositoryDirectory(sftp, repoPath, path, path),
    );
  }
}
