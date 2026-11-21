import { useSyncExternalStore, useState } from 'react';
import { hostFingerprint } from './fingerprint';
import { Input, AluneModal } from '@alune/ui';

type Policy = { hostKey: string | null };
type Request = {
  purpose: 'connect' | 'proxy-test' | 'upgrade';
  activity?: string;
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
  purpose: Request['purpose'] = 'connect',
  activity?: string,
): Promise<Policy> {
  if (request) return Promise.reject(new Error('请先完成当前主机的连接确认。'));
  return new Promise((resolve, reject) => {
    request = {
      name,
      pinned,
      purpose,
      activity,
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
  const [fingerprint, setFingerprint] = useState(item.pinned ?? '');
  if (item.purpose === 'upgrade') return <AluneModal open level={1} title={'升级远端 Agent · ' + item.name}
    description="立即重启将中断受影响的终端和任务。" okText="立即重启升级" cancelText="稍后再说"
    onOk={() => item.finish({hostKey:item.pinned})} onCancel={() => item.finish(null)}>
    <pre style={{whiteSpace:'pre-wrap', overflow:'auto',maxHeight:320}}>{item.activity}</pre>
  </AluneModal>;
  const allowInstall = item.purpose === 'connect';
  const firstConnection = allowInstall && item.pinned === null;
  const key = firstConnection ? null : hostFingerprint(fingerprint);
  const description = firstConnection
    ? '首次连接将信任服务器提供的主机密钥，连接成功后会保存指纹。请确认服务器地址和当前网络可信。'
    : item.pinned
      ? '连接时会核对已保存的 SSH 主机公钥指纹。'
      : '请核对从服务器管理员处独立获取的 SSH 主机公钥 SHA-256 指纹。';
  return (
    <AluneModal
      open
      level={1}
      title={'连接到 ' + item.name}
      description={description}
      okText={firstConnection ? '信任并连接' : '连接'}
      okDisabled={key === undefined}
      onOk={() => key !== undefined && item.finish({ hostKey: key })}
      onCancel={() => item.finish(null)}
    >
      {!firstConnection && (
        <Input
          aria-label="SSH 主机公钥 SHA-256 指纹"
          placeholder="SHA256:… 或 64 位十六进制"
          value={fingerprint}
          disabled={!!item.pinned}
          onChange={(e) => setFingerprint(e.target.value)}
        />
      )}
      {allowInstall && <p>连接时会自动准备与当前 Alune 匹配的远端 Agent。</p>}
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
