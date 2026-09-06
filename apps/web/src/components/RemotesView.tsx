import { useEffect } from 'react';
import { Button, Empty, Space, Typography } from 'antd';
import { CopyOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { PanelHeader } from './ui';

interface Props {
  repoId: string;
}

export function RemotesView({ repoId }: Props) {
  const { remotes, loading, fetchRemotes } = useRepositoryStore();

  useEffect(() => {
    void fetchRemotes(repoId);
  }, [repoId, fetchRemotes]);

  const copy = async (value: string) => {
    if (value) await navigator.clipboard?.writeText(value);
  };

  return (
    <section className="workspace-panel">
      <PanelHeader
        title="Remotes"
        count={remotes.length}
        description="Remote endpoints configured for this repository"
        icon={<LinkOutlined />}
        extra={<Button type="text" icon={<ReloadOutlined />} aria-label="Refresh remotes" onClick={() => void fetchRemotes(repoId)} loading={loading}>Refresh</Button>}
      />
      {remotes.length === 0 && !loading ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No remotes configured" />
      ) : (
        <div className="remote-list">
          {remotes.map((remote: any) => (
            <div className="remote-card" key={remote.name}>
              <div className="remote-card__heading">
                <span className="tree-node__icon"><LinkOutlined /></span>
                <strong>{remote.name}</strong>
              </div>
              <div className="remote-card__url">
                <span className="remote-card__label">Fetch</span>
                <Typography.Text ellipsis={{ tooltip: remote.fetchUrl }}>{remote.fetchUrl || '—'}</Typography.Text>
                <Button type="text" size="small" icon={<CopyOutlined />} aria-label={`Copy ${remote.name} fetch URL`} onClick={() => void copy(remote.fetchUrl)} />
              </div>
              <div className="remote-card__url">
                <span className="remote-card__label">Push</span>
                <Typography.Text ellipsis={{ tooltip: remote.pushUrl }}>{remote.pushUrl || '—'}</Typography.Text>
                <Button type="text" size="small" icon={<CopyOutlined />} aria-label={`Copy ${remote.name} push URL`} onClick={() => void copy(remote.pushUrl)} />
              </div>
            </div>
          ))}
        </div>
      )}
      {remotes.length > 0 && <Space className="panel-footnote"><Typography.Text type="secondary">Use the workspace actions to fetch, pull, or push.</Typography.Text></Space>}
    </section>
  );
}
