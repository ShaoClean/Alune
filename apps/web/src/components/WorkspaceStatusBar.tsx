import { BrandIcon } from './BrandIcon';
import { useEffect, useState } from 'react';
import {
  CloudDownloadOutlined,
  CloudServerOutlined,
  LaptopOutlined,
  PauseOutlined,
  SyncOutlined,
  WarningOutlined,
} from '@alune/ui/icons';
import type { Repository } from '@alune/domain';
import { useNavigate } from 'react-router-dom';
import { useConnectionStore } from '../stores/connectionStore';
import { connectionStatus, connectionStatusLabel } from '../stores/connectionStatus';
import { RepositorySwitcher } from './RepositorySwitcher';
import { FeedbackStatusButton, StatusButton } from '@alune/ui';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { useTerminalStore } from '../stores/terminalState';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useBackgroundSyncStore } from '../stores/backgroundSyncStore';
import {
  describeSyncCounts,
  RepositorySyncCounts,
  repositorySyncStatus,
} from './RepositorySyncCounts';

const fetchLabels = {
  fetching: '正在后台获取',
  paused: '后台获取已暂停',
  error: '后台获取失败',
  success: '后台获取完成',
};

const fetchIcons = {
  fetching: SyncOutlined,
  paused: PauseOutlined,
  error: WarningOutlined,
  success: CloudDownloadOutlined,
};

export function WorkspaceStatusBar({
  repository,
  repositories,
  version,
  inert,
  onSettings,
  onUpdates,
}: {
  repository?: Repository | null;
  repositories: Repository[];
  version: string;
  inert: boolean;
  onSettings: (category?: string) => void;
  onUpdates?: () => void;
}) {
  const navigate = useNavigate();
  const terminalCount = useTerminalStore((state) => state.sessions.length);
  const syncDetail = useSyncStatusStore((state) => state.detail);
  const syncRepoId = useSyncStatusStore((state) => state.repoId);
  const syncProgress = useSyncStatusStore((state) => state.progress);
  const repoId = repository?.id ?? '';
  const repoStatus = useRepositoryStore((state) => state.repositoryStatuses[repoId]);
  const connections = useConnectionStore((state) => state.connections);
  const statuses = useConnectionStore((state) => state.statuses);
  const connection = connections.find((item) => item.id === repository?.connectionId);
  const info = connection ? statuses[connection.id] : undefined;
  const state = connectionStatus(info);
  const syncStatus = repositorySyncStatus(repoStatus, state);
  const automatic = useWorkspaceStore(
    ({ backgroundSync }) =>
      backgroundSync.enabled && !backgroundSync.excludedRepositoryIds.includes(repoId),
  );
  const fetchState = useBackgroundSyncStore((state) => state.fetchStates[repoId]);
  const phase = automatic ? fetchState?.phase : undefined;
  const FetchIcon = phase ? fetchIcons[phase] : CloudDownloadOutlined;
  const fetchLabel = phase ? fetchLabels[phase] : '等待后台获取';
  const syncLabel = [
    automatic && fetchLabel,
    automatic && fetchState?.reason,
    automatic && fetchState?.checkedAt
      ? `上次检查 ${new Date(fetchState.checkedAt).toLocaleString()}`
      : undefined,
    syncStatus && describeSyncCounts(syncStatus),
  ]
    .filter(Boolean)
    .join(' · ');
  // Only surface the progress of the repository this status bar describes.
  const progress = repository && syncRepoId === repository.id ? syncDetail : null;
  const [longRunning, setLongRunning] = useState(false);
  useEffect(() => {
    setLongRunning(false);
    if (!progress) return;
    const timer = window.setTimeout(() => setLongRunning(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [progress, syncRepoId]);
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
        {repository && (syncStatus || automatic) && (
          <StatusButton
            className="status-button--repository-sync"
            label={`${syncLabel} · 仓库同步设置`}
            tooltip={syncLabel}
            data-phase={phase}
            onClick={() => onSettings('sync')}
          >
            {syncStatus && <RepositorySyncCounts status={syncStatus} showZero />}
            {automatic && (
              <>
                <FetchIcon aria-hidden="true" spin={phase === 'fetching'} />
                <span className="status-bar__fetch-label">{fetchLabel}</span>
              </>
            )}
          </StatusButton>
        )}
        {repository && (
          <span className="status-bar__path" title={repository.path}>
            {repository.path}
          </span>
        )}
        {progress && (
          <span className="status-bar__progress" role="status" title={syncProgress || undefined}>
            <SyncOutlined spin />
            {longRunning ? `仍在运行 · ${progress}` : progress}
            {syncProgress && (
              <span className="status-bar__progress-detail">· {syncProgress}</span>
            )}
          </span>
        )}
      </div>
      <div className="status-bar__right">
        <StatusButton
          label={`终端 ${terminalCount} · 全部会话`}
          tooltip="全部终端会话"
          onClick={() => useTerminalStore.setState({ allOpen: true })}
        >
          <BrandIcon className="terminal-entry-mark" />
          <span>终端 {terminalCount}</span>
        </StatusButton>
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
        <FeedbackStatusButton onUpdates={onUpdates} />
      </div>
    </footer>
  );
}
