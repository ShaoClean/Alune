import { runGit, type RepositoryTransport } from './repository-transport';
import { BadRequestException } from '../../ports/provider-error';
export async function pullRequestBranch(
  conn: RepositoryTransport,
  path: string,
  branch?: string,
  signal?: AbortSignal,
) {
  const current = await runGit(conn, path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal);
  const name = branch || current.stdout.trim();
  if (!name || name.length > 1024 || /[\x00-\x20~^:?*\[\\]/.test(name) || name.startsWith('-'))
    throw new BadRequestException('请选择有效的本地分支；游离 HEAD 需要先创建分支。');
  const ref = `refs/heads/${name}`;
  const result = await runGit(conn, path, ['rev-parse', '--verify', `${ref}^{commit}`], signal);
  if (result.exitCode !== 0 || !/^[a-f0-9]{40,64}$/.test(result.stdout.trim()))
    throw new BadRequestException('本地分支不存在或尚无提交，请先创建提交。');
  return { name, sha: result.stdout.trim() };
}
