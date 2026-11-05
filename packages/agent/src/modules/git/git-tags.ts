import type { GitTag, RemoteTag } from '@alune/domain';
import { signingFailure } from './git-signing';
import type { RepositoryTransport } from './repository-transport';
import { runGit } from './repository-transport';
export class GitTagReads {
  constructor(protected connection: RepositoryTransport) {}

  protected async checked(path: string, args: string[]) {
    const result = await runGit(this.connection, path, args);
    if (result.exitCode !== 0)
      throw new Error(signingFailure(result.stderr || result.stdout || '标签操作失败。'));
    return result.stdout;
  }

  async list(path: string): Promise<GitTag[]> {
    const output = await this.checked(path, [
      'for-each-ref',
      '--sort=-version:refname',
      '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(taggername)%00%(contents)%00%(contents:signature)%00',
      'refs/tags/',
    ]);
    const fields = output.split('\0');
    const tags: GitTag[] = [];
    for (let i = 0; i + 8 < fields.length; i += 8) {
      const [ref, objectHash, objectType, peeledHash, peeledType, tagger, contents, signature] =
        fields.slice(i, i + 8);
      const annotated = objectType === 'tag';
      const tag: GitTag = {
        name: ref.replace(/^\n/, '').slice('refs/tags/'.length),
        objectHash,
        objectType,
        type: annotated ? 'annotated' : 'lightweight',
        message: annotated
          ? (signature ? contents.slice(0, -signature.length) : contents).trimEnd()
          : '',
        tagger,
        ...(objectType === 'commit'
          ? { commitHash: objectHash }
          : peeledType === 'commit'
            ? { commitHash: peeledHash }
            : {}),
      };
      // Nested annotated tags need recursive peeling; blob/tree tags remain visible.
      if (annotated && peeledType === 'tag') {
        const resolved = await runGit(this.connection, path, [
          'rev-parse',
          '--verify',
          `${objectHash}^{commit}`,
        ]);
        if (resolved.exitCode === 0) tag.commitHash = resolved.stdout.trim();
      }
      tags.push(tag);
    }
    return tags;
  }

  protected async remoteUrl(path: string, remote: string) {
    if (typeof remote !== 'string' || !remote || remote.startsWith('-') || /[\0\r\n]/.test(remote))
      throw new Error('请选择有效的远程。');
    const names = (await this.checked(path, ['remote'])).trim().split('\n');
    if (!names.includes(remote)) throw new Error('远程已不存在，请刷新列表。');
    const urls = (await this.checked(path, ['remote', 'get-url', '--push', '--all', remote]))
      .trim()
      .split('\n');
    if (urls.length !== 1)
      throw new Error('此远程配置了多个推送地址，请使用只有一个推送地址的远程管理标签。');
    return urls[0];
  }

  async remoteTags(path: string, remote: string): Promise<RemoteTag[]> {
    const url = await this.remoteUrl(path, remote);
    const output = await this.checked(path, ['ls-remote', '--tags', '--refs', '--', url]);
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [objectHash, ref] = line.split('\t');
        return { name: ref.slice('refs/tags/'.length), objectHash };
      });
  }
}
