import { useEffect, useState } from 'react';
import type { SigningConfig } from '@alune/shared';
import { AluneModal, Button, DialogNote, Input, Select, Switch } from '@alune/ui';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

export function SigningSettingsDialog({
  repoId,
  onClose,
}: {
  repoId: string;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<SigningConfig>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setConfig(undefined);
    setError('');
    gitApi
      .signingConfig(repoId, controller.signal)
      .then(setConfig)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [repoId, retry]);
  const save = async () => {
    if (!config) return;
    setBusy(true);
    setError('');
    try {
      await gitApi.saveSigningConfig(repoId, config);
      void useRepositoryStore.getState().fetchLog(repoId);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AluneModal
      open
      size="sm"
      title="提交签名"
      description="读取当前生效的 Git 配置；保存仅覆盖此仓库的配置。"
      onCancel={onClose}
      onOk={save}
      okText="保存到此仓库"
      confirmLoading={busy}
      okDisabled={!config || !['openpgp', 'ssh'].includes(config.format)}
    >
      {error && (
        <DialogNote tone="danger" role="alert" title="签名配置未完成">
          {error}
          <Button size="small" disabled={busy} onClick={() => setRetry((v) => v + 1)}>
            重新读取
          </Button>
        </DialogNote>
      )}
      {!config && !error && <p role="status">正在读取签名配置…</p>}
      {config && (
        <>
          <DialogNote title={config.source === 'ssh' ? '在远端主机签名' : '在本机签名'}>
            {config.source === 'ssh'
              ? '提交和验证均在 SSH 远端执行，密钥路径、GPG／SSH agent 和验证信任配置必须在远端可用。'
              : '使用本机 Git、密钥与 agent。GPG 口令请通过系统 pinentry 弹窗或终端解锁。'}
          </DialogNote>
          <div className="dlg-fld">
            <span className="dlg-fld-label" id="signing-enabled">
              签名提交（commit.gpgsign）
            </span>
            <Switch
              style={{ justifySelf: 'start' }}
              aria-labelledby="signing-enabled"
              checked={config.enabled}
              disabled={busy}
              onChange={(enabled) => setConfig({ ...config, enabled })}
            />
          </div>
          <div className="dlg-fld">
            <span className="dlg-fld-label" id="signing-format">
              签名格式（gpg.format）
            </span>
            <Select
              aria-labelledby="signing-format"
              value={config.format}
              disabled={busy}
              onChange={(format) => setConfig({ ...config, format })}
              options={[
                { value: 'openpgp', label: 'GPG（OpenPGP）' },
                { value: 'ssh', label: 'SSH' },
                ...(!['openpgp', 'ssh'].includes(config.format)
                  ? [
                      {
                        value: config.format,
                        label: `现有格式：${config.format}（只读）`,
                        disabled: true,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          <label className="dlg-fld">
            <span className="dlg-fld-label">签名密钥（user.signingkey）</span>
            <Input
              aria-label="签名密钥"
              value={config.signingKey}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                config.format === 'ssh'
                  ? '执行主机上的密钥路径或 key::公钥'
                  : '密钥 ID／指纹；留空继承全局配置或 Git 默认值'
              }
              onChange={(event) => setConfig({ ...config, signingKey: event.target.value })}
            />
            <span className="dlg-fld-hint">
              填写密钥标识或路径，不要粘贴私钥内容。留空会移除此仓库的密钥覆盖。
            </span>
          </label>
          <DialogNote title="标签与验证">
            附注标签在提交签名或 tag.gpgsign 开启时签名；轻量标签不签名。 当前 tag.gpgsign：
            {config.tagEnabled ? '开启' : '关闭'}。
            {config.format === 'ssh' &&
              ' SSH 验证还需在执行主机配置 gpg.ssh.allowedSignersFile；仅设置签名密钥不会自动信任签名者。'}
          </DialogNote>
        </>
      )}
    </AluneModal>
  );
}
