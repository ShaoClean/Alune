import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {
  ProtocolError,
  type RepositoryResource,
  type RepositoryWriteIntent,
} from '@alune/protocol';
import { assertFileChanges } from '../git/change-entries';
import { joinRepositoryPath } from '../git/repository-path';
import { readSftpChunks } from '../git/sftp-file';
import { DiscardChanges } from '../git/discard-changes';
import { runGit } from '../git/repository-transport';
import { RepositoryReader } from './reads';

// Use stable key order so moving a JSON object through another client does
// not change its intent. Do not store arguments or config/remote credentials.
function canonical(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
}
export async function writeRevision(
  reader: RepositoryReader,
  repo: RepositoryResource,
  intent: RepositoryWriteIntent,
) {
  const snapshot = await reader.snapshot(repo);
  const hash = createHash('sha256');
  const add = (v: unknown) => hash.update(JSON.stringify(canonical(v))).update('\0');
  add([snapshot.revision, intent.kind, intent.args]);
  const git = async (args: string[], absent = false) => {
    const result = await runGit(reader.connection, repo.path, args);
    if (result.exitCode && !(absent && result.exitCode === 1))
      throw new Error('无法核验仓库快照。');
    return result.stdout;
  };
  if ((await git(['rev-parse', '--show-prefix'])).trim())
    throw new ProtocolError('conflict', 'Registered repository root moved');
  add(await git(['symbolic-ref', '--quiet', 'HEAD'], true));
  add(await git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)']));
  add(await git(['config', '--local', '--null', '--list']));
  if (['stashPop', 'stashApply', 'stashDrop'].includes(intent.kind))
    add(await git(['stash', 'list', '--format=%H']));
  if (intent.kind === 'stage' || intent.kind === 'checkout') {
    const paths = intent.args[0] as string[];
    await assertFileChanges(reader.connection, repo.path, paths, intent.kind === 'stage');
    await reader.connection.withSftp(async (files) => {
      for (const path of paths) {
        const target = joinRepositoryPath(repo.path, path);
        try {
          const stat = await promisify(files.lstat.bind(files))(target);
          add([path, stat.mode]);
          if (stat.isFile()) {
            const content = createHash('sha256');
            for await (const bytes of readSftpChunks(files, target)) {
              reader.connection.signal?.throwIfAborted();
              content.update(bytes);
            }
            add(content.digest('hex'));
          } else if (stat.isSymbolicLink())
            add(await promisify(files.readlink.bind(files))(target));
          else if (stat.isDirectory()) {
            const head = await runGit(reader.connection, target, ['rev-parse', '--verify', 'HEAD']);
            if (head.exitCode) throw new Error('无法核验子模块提交。');
            add(head.stdout);
          } else throw new Error('不支持特殊文件。');
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code)))
            throw error;
          add([path, 'missing']);
        }
      }
    });
  }
  if ((intent.kind === 'reset' && intent.args[0] === 'hard') || intent.kind === 'stash')
    add((await new DiscardChanges(reader.connection).preview(repo.path)).token);
  return hash.digest('hex');
}
