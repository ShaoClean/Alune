import { useEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { BranchesOutlined, DownOutlined, FolderOpenOutlined, HolderOutlined, RightOutlined } from '@ant-design/icons';
import type { Repository } from '@remote-git/shared';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { canMoveTreeItem, orderItems } from '../stores/sidebarOrder';
import type { Placement, TreeItem } from '../stores/sidebarOrder';

interface Connection { id: string; name: string; status?: string }
interface Props {
  connections: Connection[];
  repositories: Repository[];
  testResults: Record<string, { success: boolean }>;
  activeId?: string;
  onOpenRepository: (repo: Repository) => void;
}
type DropTarget = { item: TreeItem; placement: Placement };

export function WorkspaceTree({ connections, repositories, testResults, activeId, onOpenRepository }: Props) {
  const {
    treeOpen, setTreeOpen, collapsedConnectionIds, setConnectionCollapsed,
    connectionOrder, repositoryOrderByConnection, moveTreeItem,
  } = useWorkspaceStore();
  const [dragging, setDragging] = useState<TreeItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const dragSource = useRef<TreeItem | null>(null);
  const suppressClickUntil = useRef(0);
  const tree = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const pointerY = useRef<number | null>(null);

  const groups = orderItems(connections, connectionOrder).map((connection) => ({
    ...connection,
    repositories: orderItems(repositories.filter((repo) => repo.connectionId === connection.id), repositoryOrderByConnection[connection.id]),
  }));

  const stopScroll = () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    pointerY.current = null;
  };
  const finishDrag = () => {
    if (dragSource.current) suppressClickUntil.current = Date.now() + 250;
    dragSource.current = null;
    setDragging(null);
    setDropTarget(null);
    stopScroll();
  };

  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') finishDrag();
    };
    document.addEventListener('keydown', cancel);
    return () => { document.removeEventListener('keydown', cancel); stopScroll(); };
  }, []);

  const autoScroll = (event: DragEvent) => {
    if (!dragSource.current) return;
    pointerY.current = event.clientY;
    if (scrollFrame.current !== null) return;
    const tick = () => {
      const container = tree.current?.closest<HTMLElement>('.app-sidebar__content');
      if (!container || pointerY.current === null) { stopScroll(); return; }
      const { top, bottom } = container.getBoundingClientRect();
      const distance = pointerY.current - top < 36 ? pointerY.current - top - 36
        : bottom - pointerY.current < 36 ? 36 - (bottom - pointerY.current) : 0;
      container.scrollTop += Math.max(-14, Math.min(14, distance / 2));
      scrollFrame.current = requestAnimationFrame(tick);
    };
    scrollFrame.current = requestAnimationFrame(tick);
  };

  const startDrag = (event: DragEvent<HTMLButtonElement>, item: TreeItem) => {
    event.stopPropagation();
    dragSource.current = item;
    setDragging(item);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-remote-git-tree', JSON.stringify(item));
    if (event.currentTarget.parentElement) event.dataTransfer.setDragImage(event.currentTarget.parentElement, 15, 15);
  };

  const position = (event: DragEvent<HTMLElement>): Placement => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  const dragOver = (event: DragEvent<HTMLElement>, item: TreeItem) => {
    const source = dragSource.current;
    // Let a connection drag bubble from repository rows to the enclosing group.
    if (!source || (item.kind === 'repository' && source.kind === 'connection')) return;
    event.stopPropagation();
    if (!canMoveTreeItem(source, item)) {
      event.dataTransfer.dropEffect = 'none';
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const placement = position(event);
    setDropTarget((current) => current?.item.kind === item.kind && current.item.id === item.id && current.placement === placement
      ? current : { item, placement });
  };

  const drop = (event: DragEvent<HTMLElement>, item: TreeItem) => {
    const source = dragSource.current;
    if (!source || (item.kind === 'repository' && source.kind === 'connection')) return;
    event.preventDefault();
    event.stopPropagation();
    if (moveTreeItem(source, item, position(event))) setAnnouncement('顺序已调整');
    finishDrag();
  };

  const keyboardMove = (event: KeyboardEvent<HTMLButtonElement>, item: TreeItem, siblings: { id: string }[], name: string) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const index = siblings.findIndex((sibling) => sibling.id === item.id);
    const nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
    const neighbor = siblings[nextIndex];
    if (!neighbor) return;
    if (moveTreeItem(item, { ...item, id: neighbor.id }, nextIndex < index ? 'before' : 'after')) {
      setAnnouncement(`${name}已移至第 ${nextIndex + 1} 位`);
      const handle = event.currentTarget;
      requestAnimationFrame(() => handle.scrollIntoView({ block: 'nearest' }));
    }
  };

  const sortHandle = (item: TreeItem, siblings: { id: string }[], name: string) => (
    <button
      type="button"
      className="tree-sort-handle"
      aria-label={`调整${item.kind === 'connection' ? '连接' : '仓库'} ${name} 的顺序`}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      title="拖动排序，或按 Alt + ↑ / ↓"
      disabled={siblings.length < 2}
      draggable={siblings.length > 1}
      onDragStart={(event) => startDrag(event, item)}
      onDragEnd={finishDrag}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => keyboardMove(event, item, siblings, name)}
    ><HolderOutlined /></button>
  );

  const dropClass = (item: TreeItem) => dropTarget?.item.kind === item.kind && dropTarget.item.id === item.id
    ? ` tree-drop--${dropTarget.placement}` : '';
  const draggingClass = (item: TreeItem) => dragging?.kind === item.kind && dragging.id === item.id ? ' tree-item--dragging' : '';

  return (
    <>
      <button type="button" className="sidebar-workspace__toggle" aria-expanded={treeOpen} aria-controls="remote-workspace-tree" onClick={() => { finishDrag(); setTreeOpen(!treeOpen); }}>
        <FolderOpenOutlined className="sidebar-workspace__icon" />
        <span>远程工作区</span>
        <span className="sidebar-workspace__chevron">{treeOpen ? <DownOutlined /> : <RightOutlined />}</span>
      </button>
      {treeOpen && (
        <div
          id="remote-workspace-tree"
          className="resource-tree"
          ref={tree}
          onDragOverCapture={autoScroll}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropTarget(null); stopScroll(); }
          }}
          onClickCapture={(event) => {
            if (dragSource.current || Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
          }}
        >
          {groups.length === 0 && <div className="tree-empty">暂无连接</div>}
          {groups.map((connection) => {
            const item: TreeItem = { kind: 'connection', id: connection.id };
            const open = !collapsedConnectionIds.includes(connection.id);
            const childrenId = `connection-repositories-${connection.id}`;
            return (
              <div className={`tree-group${dropClass(item)}${draggingClass(item)}`} key={connection.id} data-connection-id={connection.id} onDragOver={(event) => dragOver(event, item)} onDrop={(event) => drop(event, item)}>
                <div className="tree-node tree-node--connection">
                  {sortHandle(item, groups, connection.name)}
                  <button className="tree-node__action" type="button" aria-expanded={open} aria-controls={childrenId} onClick={() => setConnectionCollapsed(connection.id, open)}>
                    <span className="tree-node__chevron">{open ? <DownOutlined /> : <RightOutlined />}</span>
                    <span className={`connection-dot connection-dot--${connection.status || (testResults[connection.id]?.success ? 'connected' : testResults[connection.id] ? 'error' : 'disconnected')}`} />
                    <span className="tree-node__label" title={connection.name}>{connection.name}</span>
                    <span className="tree-node__meta">{connection.repositories.length}</span>
                  </button>
                </div>
                <div id={childrenId} className="tree-group__repositories" hidden={!open}>
                  {connection.repositories.map((repo) => {
                    const repoItem: TreeItem = { kind: 'repository', id: repo.id, connectionId: connection.id };
                    return (
                      <div className={`tree-node tree-node--repo${activeId === repo.id ? ' tree-node--selected' : ''}${dropClass(repoItem)}${draggingClass(repoItem)}`} key={repo.id} data-repository-id={repo.id} onDragOver={(event) => dragOver(event, repoItem)} onDrop={(event) => drop(event, repoItem)}>
                        {sortHandle(repoItem, connection.repositories, repo.name)}
                        <button type="button" className="tree-node__action" onClick={() => onOpenRepository(repo)} aria-current={activeId === repo.id ? 'page' : undefined}>
                          <BranchesOutlined className="tree-node__icon" />
                          <span className="tree-node__label" title={repo.path}>{repo.name}</span>
                          {repo.isDirty && <span className="tree-node__dirty" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <span className="tree-sort-announcement" role="status" aria-live="polite">{announcement}</span>
    </>
  );
}
