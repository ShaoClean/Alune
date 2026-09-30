import { useEffect, useRef, useState } from 'react';
import { Popover } from 'antd';
import { LaptopOutlined, BellOutlined, CloudServerOutlined, SyncOutlined } from '@ant-design/icons';
import type { Repository } from '@alune/shared';
import { useNavigate } from 'react-router-dom';
import { useConnectionStore } from '../stores/connectionStore';
import { connectionStatus, connectionStatusLabel } from '../stores/connectionStatus';
import { RepositorySwitcher } from './RepositorySwitcher';
import { StatusButton } from './StatusButton';
import { useSyncStatusStore } from '../stores/syncStatusStore';

export function WorkspaceStatusBar({
  repository,
  repositories,
  version,
  inert,
  notices,
  onSettings,
  onUpdates,
}: {
  repository?: Repository | null;
  repositories: Repository[];
  version: string;
  inert: boolean;
  notices: string[];
  onSettings: () => void;
  onUpdates?: () => void;
}) {
  const navigate = useNavigate();
  const syncDetail = useSyncStatusStore((state) => state.detail);
  const syncRepoId = useSyncStatusStore((state) => state.repoId);
  // Only surface the progress of the repository this status bar describes.
  const progress = repository && syncRepoId === repository.id ? syncDetail : null;
  const [longRunning, setLongRunning] = useState(false);
  useEffect(() => {
    setLongRunning(false);
    if (!progress) return;
    const timer = window.setTimeout(() => setLongRunning(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [progress, syncRepoId]);
  const connections = useConnectionStore((state) => state.connections);
  const statuses = useConnectionStore((state) => state.statuses);
  const connection = connections.find((item) => item.id === repository?.connectionId);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const notificationTrigger = useRef<HTMLButtonElement>(null);
  const notificationPanel = useRef<HTMLElement>(null);
  const info = connection ? statuses[connection.id] : undefined;
  const state = connectionStatus(info);
  const local = repository?.source === 'local';
  const connectionLabel = local
    ? '本机执行'
    : !connection
      ? '未选择远程连接'
      : [`SSH ${connectionStatusLabel(info)}`, connection.name, info?.error]
          .filter(Boolean)
          .join(' · ');

  return (
    <footer className="status-bar" aria-label="工作区状态栏" inert={inert}>
      <div className="status-bar__left">
        <RepositorySwitcher
          repository={repository}
          repositories={repositories}
          connections={connections}
          statuses={statuses}
          version={version}
          onSelect={(id) => navigate(`/repositories/${id}`)}
          onBrowse={() => navigate('/repositories')}
          onConnections={() => navigate('/connections')}
          onSettings={onSettings}
        />
        {repository && <span className="status-bar__divider" aria-hidden="true" />}
        {repository && (
          <span className="status-bar__path" title={repository.path}>
            {repository.path}
          </span>
        )}
        {progress && (
          <span className="status-bar__progress" role="status">
            <SyncOutlined spin />
            {longRunning ? `仍在运行 · ${progress}` : progress}
          </span>
        )}
      </div>
      <div className="status-bar__right">
        <StatusButton
          label={connectionLabel}
          tooltip={local ? 'Git 命令在本机执行' : `${connectionLabel} · 管理连接`}
          className="status-button--connection"
          onClick={() => navigate(local ? '/repositories' : '/connections')}
        >
          {local ? <LaptopOutlined /> : <CloudServerOutlined />}
          {!local && <span className={`connection-dot connection-dot--${state}`} />}
          <span className="status-bar__connection-label">
            {local ? '本机执行' : connection?.name || '远程连接'}
          </span>
        </StatusButton>
        <Popover
          trigger="click"
          placement="topRight"
          open={notificationOpen}
          onOpenChange={setNotificationOpen}
          afterOpenChange={(open) => {
            if (open) notificationPanel.current?.focus();
          }}
          content={
            <section
              ref={notificationPanel}
              tabIndex={-1}
              className="status-notifications"
              aria-label="通知"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setNotificationOpen(false);
                  notificationTrigger.current?.focus();
                }
              }}
            >
              <strong>通知</strong>
              {notices.length ? (
                notices.map((notice) => <p key={notice}>{notice}</p>)
              ) : (
                <p>暂无新通知</p>
              )}
              {onUpdates && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setNotificationOpen(false);
                    onUpdates();
                  }}
                >
                  查看更新
                </button>
              )}
            </section>
          }
        >
          <StatusButton
            ref={notificationTrigger}
            label="通知"
            tooltip={notices.length ? `通知 · ${notices.length} 条` : '通知 · 暂无新通知'}
            aria-expanded={notificationOpen}
          >
            <BellOutlined />
            {notices.length > 0 && <span className="status-bar__notice-dot" />}
          </StatusButton>
        </Popover>
      </div>
    </footer>
  );
}
