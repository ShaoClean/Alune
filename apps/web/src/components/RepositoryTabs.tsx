import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { CloseOutlined, FolderOpenOutlined, PlusOutlined } from '@ant-design/icons';
import { horizontalPlacement, moveBeforeOrAfter } from '../stores/sidebarOrder';
import type { Placement } from '../stores/sidebarOrder';
import { tabsToClose } from '../stores/tabCommands';
import type { TabCloseCommand } from '../stores/tabCommands';

interface Props {
  repositories: any[];
  activeId?: string;
  onSelect: (id: string) => void;
  onMove: (sourceId: string, targetId: string, placement: Placement) => boolean;
  onClose: (id: string) => void;
  onCloseMany: (ids: string[], targetId: string) => void;
  onOpenRepository: () => void;
}

type DropTarget = { id: string; placement: Placement };
// `session` remounts the popup so every open aligns to its own anchor point.
type TabMenu = { id: string; x: number; y: number; session: number };
// Matches `.repository-tab-menu` in index.css.
const MENU_WIDTH = 240;

// `spoken` is the full name for screen readers; the visible label stays short.
const closeCommands: { key: TabCloseCommand; label: string; spoken: string }[] = [
  { key: 'current', label: '关闭此标签页', spoken: '关闭此标签页' },
  { key: 'others', label: '关闭其他标签页', spoken: '关闭其他标签页' },
  { key: 'right', label: '关闭右侧标签页', spoken: '关闭右侧所有标签页' },
  { key: 'left', label: '关闭左侧标签页', spoken: '关闭左侧所有标签页' },
];

export function RepositoryTabs({
  repositories,
  activeId,
  onSelect,
  onMove,
  onClose,
  onCloseMany,
  onOpenRepository,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menu, setMenu] = useState<TabMenu | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const dragSource = useRef<string | null>(null);
  const suppressClickUntil = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const pointerX = useRef<number | null>(null);
  const dragStep = useRef(0);
  const previousPositions = useRef<Map<string, number> | null>(null);
  const animations = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const previous = previousPositions.current;
    if (!previous || !scroll.current) return;
    previousPositions.current = null;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const viewport = scroll.current.getBoundingClientRect();
    for (const tab of scroll.current.querySelectorAll<HTMLElement>('[data-repository-tab]')) {
      const before = previous.get(tab.dataset.repositoryTab!);
      if (before === undefined) continue;
      const after = tab.getBoundingClientRect();
      if (after.right < viewport.left || after.left > viewport.right) continue;
      const delta = before - after.left;
      if (Math.abs(delta) < 1) continue;
      const frames =
        Math.abs(delta) > viewport.width
          ? [{ opacity: 0.55 }, { opacity: 1 }]
          : [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }];
      const animation = tab.animate(frames, {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      });
      animations.current.push(animation);
      animation.onfinish = () => {
        animations.current = animations.current.filter((current) => current !== animation);
      };
    }
  }, [repositories]);

  useEffect(() => () => animations.current.forEach((animation) => animation.cancel()), []);

  const moveWithAnimation = (source: string, target: string, placement: Placement) => {
    const reduced =
      document.documentElement.dataset.reducedMotion === 'true' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    previousPositions.current = reduced
      ? null
      : new Map(
          Array.from(
            scroll.current?.querySelectorAll<HTMLElement>('[data-repository-tab]') || [],
          ).map((tab) => [tab.dataset.repositoryTab!, tab.getBoundingClientRect().left]),
        );
    const moved = onMove(source, target, placement);
    if (!moved) previousPositions.current = null;
    return moved;
  };

  const stopScroll = () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    pointerX.current = null;
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
      if (event.key === 'Escape' && dragSource.current) finishDrag();
    };
    document.addEventListener('keydown', cancel);
    return () => {
      document.removeEventListener('keydown', cancel);
      stopScroll();
    };
  }, []);

  const autoScroll = (clientX: number) => {
    pointerX.current = clientX;
    if (scrollFrame.current !== null) return;
    const tick = () => {
      const container = scroll.current;
      if (!container || pointerX.current === null || !dragSource.current) {
        stopScroll();
        return;
      }
      const { left, right } = container.getBoundingClientRect();
      const distance =
        pointerX.current - left < 36
          ? pointerX.current - left - 36
          : right - pointerX.current < 36
            ? 36 - (right - pointerX.current)
            : 0;
      container.scrollLeft += Math.max(-14, Math.min(14, distance / 2));
      scrollFrame.current = requestAnimationFrame(tick);
    };
    scrollFrame.current = requestAnimationFrame(tick);
  };

  const targetAt = (clientX: number): DropTarget | null => {
    const elements = Array.from(
      scroll.current?.querySelectorAll<HTMLElement>('[data-repository-tab]') || [],
    );
    // Preview transforms move the painted tab, not its logical drop zone.
    const layoutRect = (tab: HTMLElement) => {
      const rect = tab.getBoundingClientRect();
      const transform = getComputedStyle(tab).transform;
      const shift = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
      return { left: rect.left - shift, right: rect.right - shift, width: rect.width };
    };
    const element = elements.find((tab) => layoutRect(tab).right >= clientX) || elements.at(-1);
    if (!element) return null;
    const rect = layoutRect(element);
    return {
      id: element.dataset.repositoryTab!,
      placement: horizontalPlacement(clientX, rect.left, rect.width),
    };
  };

  const startDrag = (event: DragEvent<HTMLDivElement>, id: string) => {
    if ((event.target as Element).closest('.repository-tab__close')) {
      event.preventDefault();
      return;
    }
    dragSource.current = id;
    setMenu(null);
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const gap = Number.parseFloat(getComputedStyle(scroll.current!).gap);
    dragStep.current =
      event.currentTarget.getBoundingClientRect().width + (Number.isFinite(gap) ? gap : 0);
    setDragging(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-alune-tab', id);
    event.dataTransfer.setDragImage(event.currentTarget, 15, 15);
  };

  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    const source = dragSource.current;
    if (!source) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    autoScroll(event.clientX);
    const target = targetAt(event.clientX);
    const ids = repositories.map((repo) => repo.id);
    const next =
      target && moveBeforeOrAfter(ids, source, target.id, target.placement) !== ids ? target : null;
    setDropTarget((current) =>
      current?.id === next?.id && current?.placement === next?.placement ? current : next,
    );
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    const source = dragSource.current;
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    const target = targetAt(event.clientX);
    finishDrag();
    if (target && moveWithAnimation(source, target.id, target.placement))
      setAnnouncement('标签顺序已调整');
  };

  const keyboardMove = (event: KeyboardEvent<HTMLButtonElement>, id: string, name: string) => {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const index = repositories.findIndex((repo) => repo.id === id);
    const nextIndex = index + (event.key === 'ArrowLeft' ? -1 : 1);
    const neighbor = repositories[nextIndex];
    if (!neighbor) return;
    if (moveWithAnimation(id, neighbor.id, nextIndex < index ? 'before' : 'after')) {
      setAnnouncement(`${name}已移至第 ${nextIndex + 1} 位`);
      const handle = event.currentTarget;
      requestAnimationFrame(() => handle.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    }
  };

  // antd only flips the popup, so narrow windows need the anchor itself kept 8px inside.
  const openMenu = (id: string, x: number, y: number) => {
    const left = Math.max(8, Math.min(x, window.innerWidth - 8 - MENU_WIDTH));
    setMenu((current) => ({ id, x: left, y, session: (current?.session ?? 0) + 1 }));
  };

  const focusTab = (id: string | undefined) =>
    requestAnimationFrame(() => {
      if (!id) return;
      const tabs = scroll.current;
      const handle =
        tabs?.querySelector<HTMLElement>(
          `[data-repository-tab="${CSS.escape(id)}"] .repository-tab__select`,
        ) || tabs?.querySelector<HTMLElement>('.repository-tab__select[aria-selected="true"]');
      handle?.focus();
    });

  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus && menu) focusTab(menu.id);
    setMenu(null);
  };

  const keyboardMenu = (event: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const tab = event.currentTarget;
    const container = scroll.current?.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    const open = () => {
      const { left, bottom } = tab.getBoundingClientRect();
      openMenu(id, Math.max(left, container?.left ?? left), bottom);
    };
    if (container && (rect.left < container.left || rect.right > container.right)) {
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      // Let this frame's scroll event pass; an open menu closes on scroll.
      requestAnimationFrame(open);
    } else open();
  };

  const runCommand = (command: TabCloseCommand, target: string) => {
    const order = repositories.map((repo) => repo.id);
    const ids = tabsToClose(order, target, command);
    if (!ids.length) return;
    if (command === 'current') onClose(target);
    else onCloseMany(ids, target);
    if (command !== 'current') setAnnouncement(`已关闭 ${ids.length} 个标签页`);
    // Focus follows the closed tab's neighbor; batch closes always keep the target.
    const index = order.indexOf(target);
    focusTab(command === 'current' ? (order[index + 1] ?? order[index - 1]) : target);
  };

  // Registry refreshes can remove the target tab while its menu is open.
  const menuTarget = menu && repositories.find((repo) => repo.id === menu.id);
  useEffect(() => {
    if (menu && !menuTarget) setMenu(null);
  }, [menu, menuTarget]);

  if (repositories.length === 0) return null;
  const sourceIndex = repositories.findIndex((repo) => repo.id === dragging);
  const previewOrder =
    dragging && dropTarget
      ? moveBeforeOrAfter(
          repositories.map((repo) => repo.id),
          dragging,
          dropTarget.id,
          dropTarget.placement,
        )
      : null;
  const destinationIndex = previewOrder?.indexOf(dragging!) ?? sourceIndex;
  const menuTitle = menuTarget
    ? menuTarget.path
      ? `${menuTarget.name} · ${menuTarget.path}`
      : menuTarget.name
    : '';
  const menuItems: MenuProps['items'] = menuTarget
    ? [
        {
          key: 'target',
          type: 'group',
          label: (
            <span className="repository-tab-menu__heading" title={menuTitle}>
              <span className="repository-tab-menu__heading-prefix">标签页 ·</span>
              <span className="repository-tab-menu__name">{menuTarget.name}</span>
            </span>
          ),
          children: closeCommands.flatMap(({ key, label, spoken }) => {
            const count = tabsToClose(
              repositories.map((repo) => repo.id),
              menuTarget.id,
              key,
            ).length;
            const item = {
              key,
              label,
              extra: <span aria-hidden="true">{count} 个</span>,
              'aria-label': `${spoken}，将关闭 ${count} 个标签页`,
              disabled: count === 0,
            };
            return key === 'current' ? [item, { type: 'divider' as const }] : [item];
          }),
        },
      ]
    : [];

  return (
    <div className="repository-tabs" aria-label="已打开的仓库">
      <div
        className={`repository-tabs__scroll${dragging ? ' repository-tabs__scroll--dragging' : ''}`}
        role="tablist"
        aria-label="已打开的仓库标签页"
        ref={scroll}
        onDragEnter={(event) => {
          if (dragSource.current) event.preventDefault();
        }}
        onDragOver={dragOver}
        onDrop={drop}
        onDragLeave={(event) => {
          const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < left ||
            event.clientX > right ||
            event.clientY < top ||
            event.clientY > bottom
          ) {
            setDropTarget(null);
            stopScroll();
          }
        }}
        onClickCapture={(event) => {
          if (dragSource.current || Date.now() < suppressClickUntil.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        // Also covers the portaled menu, where Windows' Menu key fires contextmenu on keyup.
        onContextMenu={(event) => event.preventDefault()}
      >
        {repositories.map((repo, index) => {
          const active = repo.id === activeId;
          const shift =
            destinationIndex > sourceIndex && index > sourceIndex && index <= destinationIndex
              ? -dragStep.current
              : destinationIndex < sourceIndex && index >= destinationIndex && index < sourceIndex
                ? dragStep.current
                : 0;
          return (
            <div
              className={`repository-tab${active ? ' repository-tab--active' : ''}${menuTarget?.id === repo.id ? ' repository-tab--menu-target' : ''}${dragging === repo.id ? ' repository-tab--dragging' : ''}${dragging === repo.id && dropTarget ? ' repository-tab--previewing' : ''}${dropTarget && dropTarget.id === repo.id ? ` repository-tab--drop-${dropTarget.placement}` : ''}`}
              key={repo.id}
              role="presentation"
              data-repository-tab={repo.id}
              style={shift ? { transform: `translateX(${shift}px)` } : undefined}
              draggable={repositories.length > 1}
              onDragStart={(event) => startDrag(event, repo.id)}
              onDragEnd={finishDrag}
              onContextMenu={(event) => {
                // Dropdown adds the 4px vertical gap; match it horizontally.
                if (!dragSource.current) openMenu(repo.id, event.clientX + 4, event.clientY);
              }}
              onKeyDown={(event) => keyboardMenu(event, repo.id)}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Shift+F10 ContextMenu"
                className="repository-tab__select"
                title={repo.path ? `${repo.name} · ${repo.path}` : repo.name}
                onClick={() => onSelect(repo.id)}
                onKeyDown={(event) => keyboardMove(event, repo.id, repo.name)}
              >
                <FolderOpenOutlined />
                <span className="repository-tab__name">{repo.name}</span>
                {repo.isDirty && <span className="repository-tab__dirty" aria-label="有改动" />}
              </button>
              <button
                type="button"
                className="repository-tab__close"
                aria-label={`关闭 ${repo.name}`}
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(repo.id);
                }}
              >
                <CloseOutlined />
              </button>
            </div>
          );
        })}
        {menuTarget && (
          <Dropdown
            key={menu.session}
            open
            trigger={['contextMenu']}
            autoFocus
            rootClassName="repository-tab-menu"
            onOpenChange={(open) => {
              if (!open) closeMenu();
            }}
            menu={{
              'aria-label': menuTarget.path
                ? `${menuTarget.name} 的标签页菜单，${menuTarget.path}`
                : `${menuTarget.name} 的标签页菜单`,
              items: menuItems,
              selectable: false,
              onClick: ({ key }) => {
                setMenu(null);
                runCommand(key as TabCloseCommand, menuTarget.id);
              },
              onKeyDown: (event) => {
                if (event.key === 'Escape' || event.key === 'Tab') {
                  event.preventDefault();
                  event.stopPropagation();
                  closeMenu(true);
                }
              },
            }}
          >
            <span
              className="repository-tabs__menu-anchor"
              style={{ left: menu.x, top: menu.y }}
              aria-hidden
            />
          </Dropdown>
        )}
      </div>
      <button
        type="button"
        className="repository-tabs__open"
        aria-label="打开仓库"
        onClick={onOpenRepository}
      >
        <PlusOutlined />
        <span>打开仓库</span>
      </button>
      <span className="tree-sort-announcement" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
