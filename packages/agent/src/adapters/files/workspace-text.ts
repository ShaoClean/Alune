import { randomUUID } from 'node:crypto';
import { lstat, link, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ProtocolError } from '@alune/protocol';
import { WorkspaceFileActions } from '../../modules/git/workspace-file-actions';
import type { RepositoryTransport } from '../../ports/repository-files';

// New files are installed without overwrite. For replacement, never truncate a
// symlink or hard-linked inode: install a sibling temporary file after rechecking
// the preview. Other processes are still free to modify Git/worktree files.
export async function writeWorkspaceText(
  transport: RepositoryTransport,
  root: string,
  path: string,
  content: string,
  token: string,
) {
  const preview = () => new WorkspaceFileActions(transport).preview(root, path);
  const check = async () => {
    const p = await preview();
    if (p.token !== token) throw new ProtocolError('conflict', '文件已变化，请重新确认。');
    const stat = await lstat(p.absolutePath).catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (stat && (!stat.isFile() || !p.canModify || !token))
      throw new ProtocolError('conflict', '仅可写入普通文件。');
    if (!stat && token) throw new ProtocolError('conflict', '文件已移动。');
    return { target: p.absolutePath, stat };
  };
  const { target, stat } = await check();
  const temp = join(dirname(target), '.alune-write-' + randomUUID());
  const file = await open(temp, 'wx', 0o600);
  try {
    try {
      await file.writeFile(content, 'utf8');
      if (stat) await file.chmod(stat.mode & 0o777);
      await file.sync();
    } finally {
      await file.close();
    }
    await check();
    transport.signal?.throwIfAborted();
    if (stat) await rename(temp, target);
    else await link(temp, target);
    return { success: true };
  } finally {
    await unlink(temp).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
}
