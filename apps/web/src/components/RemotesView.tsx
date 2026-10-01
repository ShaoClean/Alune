import { useFeedbackMessage } from '@alune/ui';
import { gitApi } from '../api';
import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, Space, Typography } from '@alune/ui';
import type { InputRef } from 'antd';
import { PlusOutlined, CopyOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useConnectionStore } from '../stores/connectionStore';
import { AluneModal } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { ErrorState, PanelHeader } from '@alune/ui';

const URL_PREFIXES = [
  { label: 'GitHub SSH', value: 'git@github.com:' },
  { label: 'GitHub HTTPS', value: 'https://github.com/' },
  { label: 'GitLab SSH', value: 'git@gitlab.com:' },
];

// Swapping hosts keeps the "team/repository.git" part the user already typed.
const withPrefix = (url: string, prefix: string) =>
  prefix + url.trim().replace(/^(?:[a-z][a-z0-9+.-]*:\/\/[^/]*\/|[^@\s/:]+@[^:\s/]+:)/i, '');

interface Props {
  repoId: string;
  onRefresh?: () => void;
}

export function RemotesView({ repoId, onRefresh }: Props) {
  const message = useFeedbackMessage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('origin');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const local = useRepositoryStore((state) => state.currentRepo?.source === 'local');
  const repo = useRepositoryStore(
    (state) => state.repositories.find((item) => item.id === repoId) ?? state.currentRepo,
  );
  const connectionName = useConnectionStore(
    (state) => state.connections.find((item) => item.id === repo?.connectionId)?.name,
  );
  const urlRef = useRef<InputRef>(null);
  const save = async () => {
    setSaving(true);
    try {
      await gitApi.addRemote(repoId, name.trim(), url.trim());
      setOpen(false);
      setUrl('');
      await fetchRemotes(repoId);
      onRefresh?.();
      message.success('远程已添加');
    } catch (error: any) {
      message.error(error.message);
    } finally {
      setSaving(false);
    }
  };
  const {
    remotes,
    remotesLoading: loading,
    fetchRemotes,
    error,
    errorPanel,
  } = useRepositoryStore();

  useEffect(() => {
    void fetchRemotes(repoId);
  }, [repoId, fetchRemotes]);

  const copy = async (value: string) => {
    if (value) await navigator.clipboard?.writeText(value);
  };

  return (
    <section className="workspace-panel">
      <PanelHeader
        title="远程"
        count={remotes.length}
        description="此仓库配置的远程端点"
        icon={<LinkOutlined />}
        extra={
          <>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              aria-label="刷新远程"
              onClick={() => void fetchRemotes(repoId)}
              loading={loading}
            >
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              添加远程
            </Button>
          </>
        }
      />
      {error && errorPanel === 'remotes' && !remotes.length ? (
        <ErrorState
          title="无法读取远程"
          description={error}
          onRetry={() => void fetchRemotes(repoId)}
        />
      ) : remotes.length === 0 && !loading ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无配置远程仓库" />
      ) : (
        <div className="remote-list">
          {remotes.map((remote: any) => (
            <div className="remote-card" key={remote.name}>
              <div className="remote-card__heading">
                <span className="tree-node__icon">
                  <LinkOutlined />
                </span>
                <strong>{remote.name}</strong>
              </div>
              <div className="remote-card__url">
                <span className="remote-card__label">获取</span>
                <Typography.Text ellipsis={{ tooltip: remote.fetchUrl }}>
                  {remote.fetchUrl || '—'}
                </Typography.Text>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  aria-label={`复制 ${remote.name} 的获取地址`}
                  onClick={() => void copy(remote.fetchUrl)}
                />
              </div>
              <div className="remote-card__url">
                <span className="remote-card__label">推送</span>
                <Typography.Text ellipsis={{ tooltip: remote.pushUrl }}>
                  {remote.pushUrl || '—'}
                </Typography.Text>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  aria-label={`复制 ${remote.name} 的推送地址`}
                  onClick={() => void copy(remote.pushUrl)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <AluneModal
        open={open}
        size="sm"
        glyph="link"
        eyebrow={{
          label: '远程',
          detail: local
            ? ['本机', repo?.name].filter(Boolean).join(' · ')
            : ['SSH', connectionName].filter(Boolean).join(' · '),
        }}
        title="添加远程"
        description={
          local
            ? '使用本机的 Git 凭据、SSH Agent 和 known_hosts 配置同步。'
            : '同步在远程主机上执行，使用该主机的 Git 认证配置。'
        }
        hintVerb="添加"
        onCancel={() => setOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText="添加远程"
        busyText="正在添加…"
        okDisabled={!name.trim() || !url.trim()}
      >
        <label className="dlg-fld" htmlFor="remote-name">
          <span className="dlg-fld-label">名称</span>
          <Input
            id="remote-name"
            className="dlg-mono-input"
            value={name}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="dlg-fld">
          <label className="dlg-fld-label" htmlFor="remote-url">
            地址
          </label>
          <Input
            ref={urlRef}
            id="remote-url"
            className="dlg-mono-input"
            data-autofocus
            placeholder="git@github.com:team/repository.git"
            value={url}
            autoComplete="off"
            spellCheck={false}
            prefix={<DialogIcon name="globe" />}
            onChange={(event) => setUrl(event.target.value)}
          />
          <div className="dlg-badges" role="group" aria-label="地址前缀">
            {URL_PREFIXES.map((prefix) => (
              <Button
                key={prefix.value}
                size="small"
                className="dlg-chip-btn"
                aria-pressed={url.trim().startsWith(prefix.value)}
                title={prefix.value}
                onClick={() => {
                  setUrl(withPrefix(url, prefix.value));
                  urlRef.current?.focus();
                }}
              >
                {prefix.label}
              </Button>
            ))}
          </div>
        </div>
      </AluneModal>
      {remotes.length > 0 && (
        <Space className="panel-footnote">
          <Typography.Text type="secondary">使用工作区操作来获取、拉取或推送。</Typography.Text>
        </Space>
      )}
    </section>
  );
}
