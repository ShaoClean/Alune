import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { Dropdown, Modal } from 'antd';
import {
  BranchesOutlined,
  CloudDownloadOutlined,
  DiffOutlined,
  DownOutlined,
  GlobalOutlined,
  HistoryOutlined,
  InboxOutlined,
  LoadingOutlined,
  EllipsisOutlined,
  ReloadOutlined,
  TagOutlined,
  ThunderboltOutlined,
  ClusterOutlined,
  DownloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { RepositoryStatus } from '@alune/shared';
import { ToolbarButton } from './ToolbarButton';
import { WorktreesMenu } from './WorktreesMenu';
import { WorktreesPanel } from './WorktreesPanel';
import { BranchPicker } from './BranchPicker';
import { useToolbarTier } from '../hooks/useToolbarTier';
import { syncLabel } from '../stores/syncStatusStore';
import type { SyncOperation } from '../stores/syncStatusStore';

export type RepositoryPanel = 'changes' | 'history' | 'branches' | 'stashes' | 'remotes';
export type { SyncOperation };

type ViewItem = { key: RepositoryPanel; label: string; icon: ReactElement };

const primaryViews: ViewItem[] = [
  { key: 'changes', label: '改动', icon: <DiffOutlined /> },
  { key: 'history', label: '提交历史', icon: <HistoryOutlined /> },
  { key: 'branches', label: '分支', icon: <BranchesOutlined /> },
];

export function RepositoryToolbar({
  repoId,
  status,
  activePanel,
  syncing,
  syncingForce = false,
  onSelect,
  onSync,
  onRefresh,
  onBranchSwitched,
  tier: forcedTier,
}: {
  repoId: string;
  status: RepositoryStatus | null;
  activePanel: RepositoryPanel;
  syncing: SyncOperation | null;
  syncingForce?: boolean;
  onSelect: (panel: RepositoryPanel) => void;
  onSync: (operation: SyncOperation, options?: { force?: boolean }) => void;
  onRefresh: () => void;
  onBranchSwitched: () => void;
  tier?: 'full' | 'compact' | 'condensed' | 'minimal';
}) {
  const detectedTier = useToolbarTier();
  const tier = forcedTier || detectedTier;
  const [moreOpen, setMoreOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const pushTrigger = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const branch = status ? status.branch || '游离 HEAD' : '分支未知';
  const changes = status ? new Set(status.files.map((file) => file.path)).size : undefined;
  const behind = status?.behind;
  const ahead = status?.ahead;
  const busy = syncing !== null;
  // Worktrees and the low-frequency views collapse into the overflow menu below 900px.
  const worktreesInOverflow = tier === 'condensed' || tier === 'minimal';
  const iconOnlyActions = tier !== 'full';
  const iconOnlyViews = tier === 'minimal';
  const moreActive = activePanel === 'stashes' || activePanel === 'remotes';

  useEffect(() => {
    if (!worktreesInOverflow) setWorktreesOpen(false);
  }, [worktreesInOverflow]);

  const closeMore = () => {
    setMoreOpen(false);
    moreTrigger.current?.focus();
  };
  const closePush = () => {
    setPushOpen(false);
    pushTrigger.current?.focus();
  };

  // Arrow keys move inside the view segment without leaving the group; Tab jumps to the next group.
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const items = Array.from(
      tabsRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'ArrowRight' ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  const viewCount = (key: RepositoryPanel) => (key === 'changes' ? changes : undefined);

  return (
    <div className="repository-toolbar" data-tier={tier}>
      <nav
        ref={tabsRef}
        className="repository-toolbar__views"
        aria-label="仓库视图"
        onKeyDown={onTabsKeyDown}
      >
        {primaryViews.map((view) => {
          const count = viewCount(view.key);
          const active = activePanel === view.key;
          return (
            <ToolbarButton
              key={view.key}
              variant="nav"
              label={
                count === undefined
                  ? view.label
                  : `${view.label} · ${count} 个文件`
              }
              tooltip={
                view.key === 'changes' && count === undefined
                  ? '改动 · 状态未知'
                  : count === undefined
                    ? view.label
                    : `${view.label} · ${count} 个文件`
              }
              active={active}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(view.key)}
            >
              {view.icon}
              {!iconOnlyViews && <span className="toolbar-button__label">{view.label}</span>}
              {count !== undefined && <span className="toolbar-count">{count}</span>}
            </ToolbarButton>
          );
        })}
        <Dropdown
          trigger={['click']}
          placement="bottomLeft"
          autoFocus
          open={moreOpen}
          onOpenChange={setMoreOpen}
          menu={{
            id: 'repository-more-menu',
            'aria-label': '更多仓库视图',
            selectable: true,
            selectedKeys: [activePanel],
            items: [
              {
                key: 'stashes',
                label: '储藏',
                icon: <InboxOutlined />,
                onClick: () => onSelect('stashes'),
              },
              {
                key: 'remotes',
                label: '远程',
                icon: <GlobalOutlined />,
                onClick: () => onSelect('remotes'),
              },
              {
                key: 'branch-manage',
                label: '分支管理',
                icon: <BranchesOutlined />,
                onClick: () => onSelect('branches'),
              },
              ...(worktreesInOverflow
                ? [
                    {
                      key: 'worktrees',
                      label: '关联 Worktree',
                      icon: <ClusterOutlined />,
                      onClick: () => setWorktreesOpen(true),
                    },
                  ]
                : []),
              { type: 'divider' as const },
              {
                key: 'refresh',
                label: '刷新仓库',
                icon: <ReloadOutlined />,
                disabled: busy,
                onClick: onRefresh,
              },
            ],
            onClick: closeMore,
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                closeMore();
              }
            },
          }}
        >
          <ToolbarButton
            ref={moreTrigger}
            variant="icon"
            label="更多仓库视图"
            tooltip={
              moreActive
                ? `更多仓库视图 · 当前：${activePanel === 'stashes' ? '储藏' : '远程'}`
                : '更多仓库视图'
            }
            active={moreActive}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? 'repository-more-menu' : undefined}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                setMoreOpen(true);
              }
            }}
          >
            <EllipsisOutlined />
          </ToolbarButton>
        </Dropdown>
      </nav>

      <div className="repository-toolbar__context">
        <BranchPicker
          repoId={repoId}
          branch={branch}
          behind={behind}
          disabled={busy}
          maxWidth={tier === 'condensed' ? 120 : tier === 'minimal' ? 104 : undefined}
          onSwitched={onBranchSwitched}
        />
        {!worktreesInOverflow && <WorktreesMenu repoId={repoId} />}
      </div>

      <span className="repository-toolbar__divider" aria-hidden="true" />

      <div className="repository-toolbar__actions">
        <ToolbarButton
          variant="action"
          label="拉取"
          tooltip={
            syncing === 'pull'
              ? '拉取中…'
              : status
                ? `拉取 · 落后 ${status.behind} 个提交`
                : '拉取 · 状态未知'
          }
          aria-disabled={busy}
          aria-busy={syncing === 'pull'}
          onClick={() => {
            if (!busy) onSync('pull');
          }}
        >
          {syncing === 'pull' ? <LoadingOutlined /> : <DownloadOutlined />}
          {!iconOnlyActions && (
            <span className="toolbar-button__label">
              {syncing === 'pull' ? '拉取中…' : '拉取'}
            </span>
          )}
          {!!behind && <span className="toolbar-count toolbar-count--behind">{behind}</span>}
        </ToolbarButton>

        <span className="toolbar-split">
          <ToolbarButton
            variant="primary"
            className="toolbar-split__main"
            label="推送"
            tooltip={
              syncing === 'push'
                ? syncingForce
                  ? '强制推送中…'
                  : '推送中…'
                : status
                  ? `推送 · 领先 ${status.ahead} 个提交`
                  : '推送 · 状态未知'
            }
            aria-disabled={busy}
            aria-busy={syncing === 'push'}
            onClick={() => {
              if (!busy) onSync('push');
            }}
          >
            {syncing === 'push' ? <LoadingOutlined /> : <UploadOutlined />}
            {!iconOnlyActions && (
              <span className="toolbar-button__label">
                {syncing === 'push' ? (syncingForce ? '强制推送中…' : '推送中…') : '推送'}
              </span>
            )}
            {!iconOnlyActions && !!ahead && <span className="toolbar-count">{ahead}</span>}
          </ToolbarButton>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            autoFocus
            open={pushOpen}
            onOpenChange={setPushOpen}
            menu={{
              id: 'repository-push-menu',
              'aria-label': '推送与获取',
              items: [
                {
                  key: 'push',
                  label: '推送到 origin',
                  icon: <UploadOutlined />,
                  disabled: busy,
                  onClick: () => onSync('push'),
                },
                {
                  key: 'fetch',
                  label: '获取远程更新',
                  icon: <CloudDownloadOutlined />,
                  disabled: busy,
                  onClick: () => onSync('fetch'),
                },
                {
                  key: 'push-tags',
                  label: '推送标签',
                  icon: <TagOutlined />,
                  disabled: busy,
                  onClick: () => onSync('push'),
                },
                { type: 'divider' as const },
                {
                  key: 'force-push',
                  danger: true,
                  label: '强制推送（含租约）',
                  icon: <ThunderboltOutlined />,
                  disabled: busy,
                  onClick: () => onSync('push', { force: true }),
                },
              ],
              onClick: closePush,
              onKeyDown: (event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  closePush();
                }
              },
            }}
          >
            <ToolbarButton
              ref={pushTrigger}
              variant="primary"
              className="toolbar-split__toggle"
              label="更多推送选项"
              tooltip="更多推送选项 · 获取 / 推送标签 / 强制推送"
              aria-haspopup="menu"
              aria-expanded={pushOpen}
              aria-controls={pushOpen ? 'repository-push-menu' : undefined}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  setPushOpen(true);
                }
              }}
            >
              <DownOutlined />
            </ToolbarButton>
          </Dropdown>
        </span>
      </div>

      <Modal
        title={null}
        footer={null}
        open={worktreesOpen}
        destroyOnHidden
        className="worktrees-dialog"
        aria-label="关联 Worktree"
        onCancel={() => setWorktreesOpen(false)}
      >
        <WorktreesPanel
          repoId={repoId}
          active={worktreesOpen}
          onOpened={() => setWorktreesOpen(false)}
          onDismiss={() => setWorktreesOpen(false)}
        />
      </Modal>
    </div>
  );
}

export { syncLabel };
