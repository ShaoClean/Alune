import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement, WheelEvent } from 'react';
import { Dropdown } from 'antd';
import {
  BranchesOutlined,
  CloudDownloadOutlined,
  DiffOutlined,
  DownOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  HistoryOutlined,
  InboxOutlined,
  PullRequestOutlined,
  LoadingOutlined,
  ReloadOutlined,
  TagOutlined,
  ThunderboltOutlined,
  DownloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { RepositoryStatus } from '@alune/shared';
import { ToolbarButton } from './ToolbarButton';
import { WorktreesMenu } from './WorktreesMenu';
import { BranchPicker } from './BranchPicker';
import { useToolbarTier } from '../hooks/useToolbarTier';
import { syncLabel } from '../stores/syncStatusStore';
import type { SyncOperation } from '../stores/syncStatusStore';

export type RepositoryPanel = 'changes' | 'files' | 'history' | 'branches' | 'stashes' | 'remotes' | 'pull-requests';
export type { SyncOperation };

type ViewItem = { key: RepositoryPanel; label: string; icon: ReactElement };

// Every view is a direct tab; there is no overflow menu for low-frequency views.
export const repositoryViews: ViewItem[] = [
  { key: 'changes', label: '改动', icon: <DiffOutlined /> },
  { key: 'files', label: '文件', icon: <FolderOpenOutlined /> },
  { key: 'history', label: '提交历史', icon: <HistoryOutlined /> },
  { key: 'branches', label: '分支', icon: <BranchesOutlined /> },
  { key: 'stashes', label: '储藏', icon: <InboxOutlined /> },
  { key: 'remotes', label: '远程', icon: <GlobalOutlined /> },
  { key: 'pull-requests', label: 'PR/MR', icon: <PullRequestOutlined /> },
];

type Edges = { start: boolean; end: boolean };

// Tabs keep their labels while they fit, fall back to icons, and only then scroll
// sideways. The labelled width is remembered so the labels return without flicker.
function useFittedViews(allowLabels: boolean, contentKey: unknown) {
  const nav = useRef<HTMLElement>(null);
  const labelledWidth = useRef(0);
  const labelledNow = useRef(allowLabels);
  const [labelled, setLabelled] = useState(allowLabels);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  const show = useCallback((value: boolean) => {
    labelledNow.current = value;
    setLabelled(value);
  }, []);

  const measureEdges = useCallback(() => {
    const element = nav.current;
    if (!element) return;
    const start = element.scrollLeft > 1;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setEdges((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);

  const fit = useCallback(() => {
    const element = nav.current;
    if (!element) return;
    // The nav takes the space left by branch context and actions, so its own width
    // does not depend on whether labels are shown.
    if (!allowLabels) {
      if (labelledNow.current) show(false);
    } else if (labelledNow.current && element.scrollWidth > element.clientWidth + 1) {
      labelledWidth.current = element.scrollWidth;
      show(false);
    } else if (!labelledNow.current && element.clientWidth >= labelledWidth.current) show(true);
    measureEdges();
  }, [allowLabels, measureEdges, show]);

  // A different count changes the labelled width, so labels are tried again before paint.
  useLayoutEffect(() => {
    labelledWidth.current = 0;
    show(allowLabels);
  }, [allowLabels, contentKey, show]);

  useLayoutEffect(fit, [fit, labelled]);

  useEffect(() => {
    const element = nav.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  return { nav, labelled, edges, measureEdges };
}

export function RepositoryToolbar({
  repoId,
  status,
  activePanel,
  syncing,
  syncingForce = false,
  refreshing = false,
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
  refreshing?: boolean;
  onSelect: (panel: RepositoryPanel) => void;
  onSync: (operation: SyncOperation, options?: { force?: boolean }) => void;
  onRefresh: () => void;
  onBranchSwitched: () => void;
  tier?: 'full' | 'compact' | 'condensed' | 'minimal';
}) {
  const detectedTier = useToolbarTier();
  const tier = forcedTier || detectedTier;
  const [pushOpen, setPushOpen] = useState(false);
  const pushTrigger = useRef<HTMLButtonElement>(null);

  const branch = status ? status.branch || '游离 HEAD' : '分支未知';
  const changes = status ? new Set(status.files.map((file) => file.path)).size : undefined;
  const behind = status?.behind;
  const ahead = status?.ahead;
  const busy = syncing !== null;
  const iconOnlyActions = tier !== 'full';
  const { nav, labelled, edges, measureEdges } = useFittedViews(tier !== 'minimal', changes);

  // Keep the selected tab visible when the row has to scroll. The nav is scrolled
  // directly so that no outer container moves.
  useEffect(() => {
    const element = nav.current;
    const current = element?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!element || !current) return;
    const box = element.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.left < box.left) element.scrollLeft -= box.left - item.left + 8;
    else if (item.right > box.right) element.scrollLeft += item.right - box.right + 8;
    measureEdges();
  }, [activePanel, labelled, nav, measureEdges]);

  const closePush = () => {
    setPushOpen(false);
    pushTrigger.current?.focus();
  };

  // Arrow keys move inside the view segment without leaving the group; Tab jumps to the next group.
  const onTabsKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      nav.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowRight'
            ? index + 1
            : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  // A vertical wheel scrolls the row sideways once the tabs no longer fit.
  const onTabsWheel = (event: WheelEvent<HTMLElement>) => {
    const element = nav.current;
    if (!element || element.scrollWidth <= element.clientWidth) return;
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) element.scrollLeft += event.deltaY;
  };

  const viewCount = (key: RepositoryPanel) => (key === 'changes' ? changes : undefined);
  const overflow = edges.start && edges.end ? 'both' : edges.start ? 'start' : edges.end ? 'end' : undefined;

  return (
    <div className="repository-toolbar" data-tier={tier}>
      <nav
        ref={nav}
        className="repository-toolbar__views"
        aria-label="仓库视图"
        data-labels={labelled ? 'shown' : 'hidden'}
        data-overflow={overflow}
        onKeyDown={onTabsKeyDown}
        onWheel={onTabsWheel}
        onScroll={measureEdges}
      >
        {repositoryViews.map((view) => {
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
              {labelled && <span className="toolbar-button__label">{view.label}</span>}
              {count !== undefined && <span className="toolbar-count">{count}</span>}
            </ToolbarButton>
          );
        })}
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
        <WorktreesMenu repoId={repoId} />
      </div>

      <span className="repository-toolbar__divider" aria-hidden="true" />

      <div className="repository-toolbar__actions">
        <ToolbarButton
          variant="icon"
          label="刷新仓库"
          tooltip={refreshing ? '正在刷新仓库…' : '刷新仓库'}
          aria-disabled={busy || refreshing}
          aria-busy={refreshing}
          onClick={() => {
            if (!busy && !refreshing) onRefresh();
          }}
        >
          {refreshing ? <LoadingOutlined /> : <ReloadOutlined />}
        </ToolbarButton>
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
    </div>
  );
}

export { syncLabel };
