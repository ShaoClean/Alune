import { GitSigningReads } from './git-signing';
import type { SigningConfig } from '@alune/domain';
import type { RepositoryTransport } from './repository-transport';
import { runGit } from './repository-transport';

export { signatureStatus, signingFailure } from './git-signing';
export class GitSigning extends GitSigningReads {
  declare protected connection: RepositoryTransport;
  constructor(connection: RepositoryTransport) {
    super(connection);
  }

  async save(path: string, value: SigningConfig) {
    if (
      !value ||
      typeof value.enabled !== 'boolean' ||
      !['openpgp', 'ssh'].includes(value.format) ||
      typeof value.signingKey !== 'string' ||
      /[\0\r\n]/.test(value.signingKey)
    )
      throw new Error('请提供有效的签名开关、GPG／SSH 格式和密钥标识。');
    // Write the switch last so enabling never observes a half-written key/format.
    for (const [key, setting] of [
      ['user.signingkey', value.signingKey.trim()],
      ['gpg.format', value.format],
      ['commit.gpgsign', String(value.enabled)],
    ]) {
      const unset = key === 'user.signingkey' && !setting;
      const result = await runGit(
        this.connection,
        path,
        unset
          ? ['config', '--local', '--unset-all', key]
          : ['config', '--local', '--replace-all', key, setting],
      );
      if (result.exitCode !== 0 && !(unset && result.exitCode === 5))
        throw new Error(`签名配置未完整保存，请重新读取后重试：${result.stderr}`);
    }
    return this.read(path);
  }
}
