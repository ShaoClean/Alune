import { useEffect } from 'react';
import { Button, Empty, Space, Typography } from 'antd';
import { CopyOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { PanelHeader } from './ui';

interface Props {
  repoId: string;
}

export function RemotesView({ repoId }: Props) {
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
        extra={<Button type="text" icon={<ReloadOutlined />} aria-label="刷新远程" onClick={() => void fetchRemotes(repoId)} loading={loading}>刷新</Button>}
      />
      {remotes.length === 0 && !loading ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无配置远程仓库" />
      ) : (
        <div className="remote-list">
          {remotes.map((remote: any) => (
            <div className="remote-card" key={remote.name}>
              <div className="remote-card__heading">
                <span className="tree-node__icon"><LinkOutlined /></span>
                <strong>{remote.name}</strong>
              </div>
              <div className="remote-card__url">
                <span className="remote-card__label">获取</span>
                <Typography.Text ellipsis={{ tooltip: remote.fetchUrl }}>{remote.fetchUrl || '—'}</Typography.Text>
                <Button type="text" size="small" icon={<CopyOutlined />} aria-label={`复制 ${remote.name} 的获取地址`} onClick={() => void copy(remote.fetchUrl)} />
              </div>
              <div className="remote-card__url">
                <span className="remote-card__label">推送</span>
                <Typography.Text ellipsis={{ tooltip: remote.pushUrl }}>{remote.pushUrl || '—'}</Typography.Text>
                <Button type="text" size="small" icon={<CopyOutlined />} aria-label={`复制 ${remote.name} 的推送地址`} onClick={() => void copy(remote.pushUrl)} />
              </div>
            </div>
          ))}
        </div>
      )}
      {remotes.length > 0 && <Space className="panel-footnote"><Typography.Text type="secondary">使用工作区操作来获取、拉取或推送。</Typography.Text></Space>}
    </section>
  );
}
