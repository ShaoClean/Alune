import { gitApi } from '../api';
import { useEffect, useState } from 'react';
import { App, Button, Empty, Input, Modal, Space, Typography } from 'antd';
import { PlusOutlined, CopyOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { PanelHeader } from './ui';

interface Props {
  repoId: string;
  onRefresh?: () => void;
}

export function RemotesView({ repoId, onRefresh }: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('origin');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const local = useRepositoryStore((state) => state.currentRepo?.source === 'local');
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
  const { remotes, remotesLoading: loading, fetchRemotes } = useRepositoryStore();

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
      {remotes.length === 0 && !loading ? (
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
      <Modal
        title="添加远程"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="添加远程"
        okButtonProps={{ disabled: !name.trim() || !url.trim() }}
      >
        <p className="modal-description">
          {local
            ? '同步使用本机的 Git 凭据、SSH Agent 和 known_hosts 配置。'
            : '同步在远程主机上运行，使用该主机的 Git 认证配置。'}
        </p>
        <label className="git-form-label" htmlFor="remote-name">
          名称
        </label>
        <Input id="remote-name" value={name} onChange={(event) => setName(event.target.value)} />
        <label className="git-form-label" htmlFor="remote-url">
          地址
        </label>
        <Input
          id="remote-url"
          placeholder="git@github.com:team/repository.git"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </Modal>
      {remotes.length > 0 && (
        <Space className="panel-footnote">
          <Typography.Text type="secondary">使用工作区操作来获取、拉取或推送。</Typography.Text>
        </Space>
      )}
    </section>
  );
}
