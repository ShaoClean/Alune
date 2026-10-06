import type { CommitSignature, SigningConfig } from '@alune/shared';
import { runGit } from './repository-transport';
import type { RepositoryTransport } from './repository-transport';

export function signingFailure(detail: string): string {
  if (
    !/gpg|signing|sign_data|signer|ssh-keygen|pinentry|secret key|public key|private key|agent refused|agent socket/i.test(
      detail,
    )
  )
    return detail;
  let advice = '请检查 user.signingkey、签名程序及密钥是否可用。';
  if (/pinentry|inappropriate ioctl|tty|passphrase|cancelled|canceled/i.test(detail))
    advice =
      'GPG 请配置可弹窗的 pinentry；SSH 请用 ssh-add 加载密钥。也可在终端解锁后重试；Alune 不会收集密钥口令。';
  else if (/agent|socket/i.test(detail))
    advice = '请启动 GPG／SSH agent 并加载签名密钥，确保 Alune 的执行环境可访问 agent。';
  else if (/key|no such file|not found/i.test(detail))
    advice = '请检查签名密钥是否存在、路径是否正确，以及 GPG／ssh-keygen 是否已安装。';
  return `签名失败，操作未完成。${advice} SSH 仓库请在远端主机检查。\nGit 原因：${detail}`;
}

/** Retain Git's code: U means cryptographically good but identity not trusted. */
export function signatureStatus(code: string): CommitSignature['status'] {
  if (code === 'G') return 'valid';
  if (code === 'N') return 'unsigned';
  if (code === 'U' || code === 'E') return 'unknown';
  if (['B', 'X', 'Y', 'R'].includes(code)) return 'invalid';
  return 'unknown';
}

export class GitSigning {
  constructor(private connection: RepositoryTransport) {}

  private async config(path: string, key: string, bool = false) {
    const result = await runGit(this.connection, path, [
      'config',
      ...(bool ? ['--bool'] : []),
      '--get',
      key,
    ]);
    if (result.exitCode === 1) return undefined;
    if (result.exitCode !== 0) throw new Error(`无法读取签名配置：${result.stderr}`);
    return result.stdout.trim();
  }

  async read(path: string): Promise<SigningConfig> {
    const [enabled, format, signingKey, tagEnabled] = await Promise.all([
      this.config(path, 'commit.gpgsign', true),
      this.config(path, 'gpg.format'),
      this.config(path, 'user.signingkey'),
      this.config(path, 'tag.gpgsign', true),
    ]);
    return {
      enabled: enabled === 'true',
      format: format || 'openpgp',
      signingKey: signingKey || '',
      tagEnabled: tagEnabled === 'true',
    };
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

  async signatures(path: string, hashes: string[]): Promise<CommitSignature[]> {
    if (
      !Array.isArray(hashes) ||
      !hashes.length ||
      hashes.length > 100 ||
      hashes.some(
        (hash) => typeof hash !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(hash),
      )
    )
      throw new Error('每次签名验证需要 1 至 100 个完整提交哈希。');
    // No graph traversal or permanent cache: trust stores and allowed signers can change.
    const signal = AbortSignal.timeout(30_000);
    const result = await runGit(
      this.connection,
      path,
      [
        'log',
        '--no-walk=unsorted',
        '--no-color',
        '--no-decorate',
        '--no-show-signature',
        '-z',
        '--format=%H%x00%G?%x00%GS%x00%GK',
        ...new Set(hashes),
        '--',
      ],
      signal,
      { maxOutputBytes: 1024 * 1024 },
    );
    if (result.exitCode !== 0)
      throw new Error(`无法验证提交签名，请检查执行主机的验证密钥和签名程序：${result.stderr}`);
    const fields = result.stdout.split('\0');
    if (fields.at(-1) === '') fields.pop();
    if (fields.length % 4) throw new Error('签名验证结果不完整，请重试。');
    const signatures: CommitSignature[] = [];
    for (let i = 0; i < fields.length; i += 4) {
      const [hash, code, signer, key] = fields.slice(i, i + 4);
      signatures.push({ hash, code, status: signatureStatus(code), signer, key });
    }
    if (signatures.length !== new Set(hashes).size)
      throw new Error('部分提交无法验证，请刷新历史后重试。');
    // Git 2.43 reports N for signed SSH commits when allowedSignersFile is absent.
    // Inspect raw headers in one bounded batch so these never appear as unsigned.
    const uncertain = signatures.filter((item) => item.code === 'N');
    if (uncertain.length) {
      const raw = await runGit(
        this.connection,
        path,
        [
          'show',
          '--no-patch',
          '--format=raw',
          '--no-color',
          '--no-decorate',
          '--no-show-signature',
          '--no-notes',
          ...uncertain.map((item) => item.hash),
          '--',
        ],
        signal,
        { maxOutputBytes: 4 * 1024 * 1024 },
      );
      if (raw.exitCode !== 0) throw new Error(`无法读取签名头：${raw.stderr}`);
      for (const block of raw.stdout.split(/^commit /m).slice(1)) {
        const hash = block.slice(0, block.indexOf('\n'));
        const headers = block.split('\n\n', 1)[0];
        if (/^gpgsig(?:-sha256)? /m.test(headers)) {
          const item = signatures.find((item) => item.hash === hash);
          if (item) {
            item.status = 'unknown';
            item.code = 'E';
          }
        }
      }
    }
    return signatures;
  }
}
