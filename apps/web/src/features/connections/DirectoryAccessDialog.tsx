import { useEffect, useState } from 'react';
import { AluneModal, Button, DialogField, Input, OptionCards } from '@alune/ui';
import type { DirectoryAccess, DirectoryGrant } from '@alune/protocol';
import { fileAccessApi } from '../../api/file-access';

export function DirectoryAccessDialog({
  connection,
  onClose,
}: {
  connection: { id: string; name: string };
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<DirectoryGrant[]>([]);
  const [path, setPath] = useState('');
  const [access, setAccess] = useState<DirectoryAccess>('read');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setGrants(await fileAccessApi.grants(connection.id));
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [connection.id]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AluneModal
      open
      title={`${connection.name} 的目录授权`}
      okText="授权此目录"
      okDisabled={!path.trim()}
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() =>
        run(async () => {
          await fileAccessApi.grant(connection.id, path, access);
          setPath('');
        })
      }
    >
      <p>仅授权填写的目录。授权只在当前连接有效，断线后需重新授权；可随时撤销。</p>
      <DialogField label="远程绝对目录" htmlFor="directory-access-path">
        <Input
          id="directory-access-path"
          value={path}
          disabled={busy}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/work/notes 或 C:\work\notes"
        />
      </DialogField>
      <OptionCards
        label="目录权限"
        value={access}
        onChange={setAccess}
        options={[
          {
            value: 'read' as const,
            title: '读取',
            description: '列出目录并读取文本',
            icon: 'folder' as const,
          },
          {
            value: 'read-write' as const,
            title: '读写',
            description: '也允许创建和修改文本',
            icon: 'pencil' as const,
          },
        ]}
      />
      {error && <p role="alert">{error}</p>}
      <ul aria-label="已授权目录">
        {grants.map((g) => (
          <li key={g.id}>
            <code>{g.path}</code> · {g.access === 'read' ? '读取' : '读写'}{' '}
            <Button
              disabled={busy}
              onClick={() => run(() => fileAccessApi.revoke(connection.id, g))}
            >
              撤销
            </Button>
          </li>
        ))}
      </ul>
    </AluneModal>
  );
}
