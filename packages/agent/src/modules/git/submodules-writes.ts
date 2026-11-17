import { GitSubmoduleReads } from './submodules';
import { runGit, type RepositoryTransport } from './repository-transport';
export class GitSubmodules extends GitSubmoduleReads {
  declare protected connection: RepositoryTransport;
  constructor(connection: RepositoryTransport) {
    super(connection);
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
}
