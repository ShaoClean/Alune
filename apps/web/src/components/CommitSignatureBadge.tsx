import type { CommitSignature } from '@alune/shared';
const reasons: Record<string, string> = {
  G: '执行主机验证通过',
  B: '签名不匹配',
  U: '签名正确，但签名者身份未受信任',
  X: '签名已过期',
  Y: '签名密钥已过期',
  R: '签名密钥已撤销',
  E: '无法验证：可能缺少公钥、allowedSignersFile 或验证程序',
  N: '此提交没有签名',
};
export function CommitSignatureBadge({
  signature,
  error,
  detail = false,
}: {
  signature?: CommitSignature;
  error?: string;
  detail?: boolean;
}) {
  const label = !signature
    ? error
      ? '验证失败'
      : '验证中…'
    : { valid: '签名有效', invalid: '签名无效', unknown: '未知密钥／信任', unsigned: '未签名' }[
        signature.status
      ];
  const description = signature
    ? [reasons[signature.code] || '未知验证结果', signature.signer, signature.key]
        .filter(Boolean)
        .join(' · ')
    : error || '正在执行主机验证签名';
  return (
    <span
      className={`commit-signature commit-signature--${signature?.status || 'pending'}${detail ? ' commit-signature--detail' : ''}`}
      title={description}
    >
      {label}
      {detail && <small>{description}</small>}
    </span>
  );
}
