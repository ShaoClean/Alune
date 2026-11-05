import { useSyncExternalStore, useState } from 'react';
import { hostFingerprint } from './fingerprint';
import { Input, AluneModal } from '@alune/ui';

type Policy = { hostKey: string; install: boolean };
type Request = {
  allowInstall: boolean;
  name: string;
  pinned: string | null;
  finish: (p: Policy | null) => void;
};
let request: Request | null = null;
const changes = new Set<() => void>();
function notify() {
  for (const fn of changes) fn();
}
export function hostConsent(
  name: string,
  pinned: string | null,
  allowInstall = true,
): Promise<Policy> {
  if (request) return Promise.reject(new Error('请先完成当前主机的连接确认。'));
  return new Promise((resolve, reject) => {
    request = {
      name,
      pinned,
      allowInstall,
      finish(policy) {
        request = null;
        notify();
        if (policy) resolve(policy);
        else reject(new Error('已取消连接。'));
      },
    };
    notify();
  });
}
function Consent({ item }: { item: Request }) {
  const [fingerprint, setFingerprint] = useState(item.pinned ?? ''),
    [install, setInstall] = useState(false);
  const key = hostFingerprint(fingerprint);
  return (
    <AluneModal
      open
      level={1}
      title={'连接到 ' + item.name}
      description="请核对从服务器管理员处独立获取的 SSH 主机公钥 SHA-256 指纹。"
      okText="连接"
      okDisabled={!key}
      onOk={() => key && item.finish({ hostKey: key, install })}
      onCancel={() => item.finish(null)}
    >
      <Input
        aria-label="SSH 主机公钥 SHA-256 指纹"
        placeholder="SHA256:… 或 64 位十六进制"
        value={fingerprint}
        disabled={!!item.pinned}
        onChange={(e) => setFingerprint(e.target.value)}
      />
      {item.allowInstall && (
        <label>
          <input type="checkbox" checked={install} onChange={(e) => setInstall(e.target.checked)} />
          允许在这台服务器上安装或升级 Alune 运行包
        </label>
      )}
    </AluneModal>
  );
}
const subscribe = (fn: () => void) => {
  changes.add(fn);
  return () => {
    changes.delete(fn);
  };
};
export function HostConsentDialog() {
  const item = useSyncExternalStore(subscribe, () => request);
  return item ? <Consent item={item} /> : null;
}
