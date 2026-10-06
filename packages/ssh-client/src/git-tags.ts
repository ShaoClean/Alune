import type {
  GitTag,
  RemoteTag,
  CreateTagOptions,
  DeleteTagOptions,
  PushTagOptions,
  CheckoutTagOptions,
} from '@alune/shared';
import { GitSigning, signingFailure } from './git-signing';
import { runGit } from './repository-transport';
import type { RepositoryTransport } from './repository-transport';

/** All tag operations share the local/SSH transport and use full refs. */
export class GitTags {
  constructor(private connection: RepositoryTransport) {}

  private async checked(path: string, args: string[]) {
    const result = await runGit(this.connection, path, args);
    if (result.exitCode !== 0)
      throw new Error(signingFailure(result.stderr || result.stdout || '标签操作失败。'));
    return result.stdout;
  }

  private async ref(path: string, name: string) {
    if (typeof name !== 'string' || !name || name.startsWith('-') || name.includes('\0'))
      throw new Error('请输入有效的标签名称。');
    const ref = `refs/tags/${name}`;
    const result = await runGit(this.connection, path, ['check-ref-format', ref]);
    if (result.exitCode !== 0)
      throw new Error('标签名称无效，不能包含空格、..、~、^、:、?、*、[ 或反斜杠。');
    return ref;
  }

  private async snapshot(path: string, name: string, expected: string) {
    const ref = await this.ref(path, name);
    const hash = (await this.checked(path, ['show-ref', '--verify', '--hash', ref])).trim();
    if (typeof expected !== 'string' || hash !== expected)
      throw new Error('标签已变化，请刷新列表后重试。');
    return ref;
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

  private async remoteUrl(path: string, remote: string) {
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

  async create(path: string, options: CreateTagOptions) {
    const ref = await this.ref(path, options.name);
    if (!['lightweight', 'annotated'].includes(options.type)) throw new Error('请选择标签类型。');
    if (
      options.type === 'annotated' &&
      (typeof options.message !== 'string' ||
        !options.message.trim() ||
        options.message.includes('\0'))
    )
      throw new Error('请填写有效的标签附注。');
    const target = options.target ?? 'HEAD';
    if (
      target !== 'HEAD' &&
      (typeof target !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(target))
    )
      throw new Error('请选择 HEAD 或提交历史中的完整提交哈希。');
    const exists = await runGit(this.connection, path, ['show-ref', '--verify', '--quiet', ref]);
    if (exists.exitCode === 0) throw new Error('已存在同名标签，请使用其他名称。');
    const hash = (
      await this.checked(path, ['rev-parse', '--verify', '--end-of-options', `${target}^{commit}`])
    ).trim();
    const config =
      options.type === 'annotated' ? await new GitSigning(this.connection).read(path) : null;
    const sign = !!config && (config.enabled || config.tagEnabled);
    // Git's verbatim mode does not add the newline required before signature armor.
    const message =
      sign && !options.message!.endsWith('\n') ? options.message + '\n' : options.message;
    const result = await runGit(this.connection, path, [
      '-c',
      'tag.gpgSign=false',
      'tag',
      sign ? '--sign' : '--no-sign',
      ...(options.type === 'annotated'
        ? [...(sign ? [] : ['-a']), '--cleanup=verbatim', '-m', message!]
        : []),
      '--',
      options.name,
      hash,
    ]);
    if (result.exitCode !== 0) throw new Error(signingFailure(result.stderr || result.stdout));
    if (sign) {
      // Some Git versions return success after ssh-keygen fails and leave an unsigned tag.
      const objectHash = (await this.checked(path, ['rev-parse', '--verify', ref])).trim();
      const object = await this.checked(path, ['cat-file', 'tag', objectHash]);
      const unsignedBody = object.slice(object.indexOf('\n\n') + 2);
      if (unsignedBody === message || !/\n-----BEGIN (?:SSH|PGP) SIGNATURE-----\n/.test(object)) {
        const removed = await runGit(this.connection, path, ['update-ref', '-d', ref, objectHash]);
        throw new Error(
          signingFailure(result.stderr || 'signing failed: 未生成标签签名。') +
            (removed.exitCode === 0
              ? '\n未签名的标签已撤销。'
              : '\n标签已变化，未自动撤销，请刷新检查。'),
        );
      }
    }
    return { success: true };
  }

  async push(path: string, options: PushTagOptions) {
    if (
      (options.all !== undefined && typeof options.all !== 'boolean') ||
      (options.all === true ? options.name !== undefined : typeof options.name !== 'string')
    )
      throw new Error('请选择单个标签或推送全部标签。');
    await this.remoteUrl(path, options.remote);
    const ref = options.all ? 'refs/tags/*' : await this.ref(path, options.name!);
    await this.checked(path, ['push', '--no-follow-tags', '--', options.remote, `${ref}:${ref}`]);
    return { success: true };
  }

  async delete(path: string, options: DeleteTagOptions) {
    if (options.confirmed !== true) throw new Error('请确认删除标签。');
    const ref = await this.snapshot(path, options.name, options.objectHash);
    if (options.remote !== undefined) {
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options.remoteObjectHash ?? ''))
        throw new Error('请先读取远程标签状态，再确认删除。');
      await this.remoteUrl(path, options.remote);
      // A changed remote tag is rejected; failed remote deletion leaves the local tag intact.
      await this.checked(path, [
        'push',
        '--no-follow-tags',
        `--force-with-lease=${ref}:${options.remoteObjectHash}`,
        '--',
        options.remote,
        `:${ref}`,
      ]);
    }
    try {
      await this.checked(path, ['update-ref', '-d', ref, options.objectHash]);
    } catch (error) {
      if (options.remote)
        throw new Error(`远程标签已删除，但本地删除失败，请刷新确认：${(error as Error).message}`);
      throw error;
    }
    return { success: true };
  }

  async checkout(path: string, options: CheckoutTagOptions) {
    await this.snapshot(path, options.name, options.objectHash);
    const hash = (
      await this.checked(path, ['rev-parse', '--verify', `${options.objectHash}^{commit}`])
    ).trim();
    if (options.branch !== undefined) {
      if (
        typeof options.branch !== 'string' ||
        !options.branch ||
        options.branch.startsWith('-') ||
        options.branch.includes('\0')
      )
        throw new Error('请输入有效的分支名称。');
      await this.checked(path, ['check-ref-format', `refs/heads/${options.branch}`]);
      await this.checked(path, ['switch', '-c', options.branch, hash]);
    } else {
      if (options.confirmed !== true) throw new Error('请确认进入游离 HEAD 状态。');
      await this.checked(path, ['switch', '--detach', hash]);
    }
    return { success: true };
  }
}
