import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, Dropdown, Input, AluneModal, Tooltip } from '@alune/ui';
import {
  PlusOutlined,
  ExpandOutlined,
  CompressOutlined,
  DownOutlined,
  UnorderedListOutlined,
  LayoutOutlined,
} from '@alune/ui/icons';
import { TERMINAL_LIMITS, type Repository, type TerminalSession } from '@alune/domain';
import { BrandIcon } from '../BrandIcon';
import { createTerminal, getTerminalRuntime, pasteTerminal } from '../../stores/terminalStore';
import {
  tabNumber,
  terminalName,
  terminalStateLabel,
  useTerminalStore,
  type SplitAxis,
  type ViewSession,
} from '../../stores/terminalState';
import { TerminalPane } from './TerminalPane';
import { useTerminalTabDrag, type DropEdge } from './useTerminalTabDrag';

const edges = { left: '左侧', right: '右侧', top: '上方', bottom: '下方', center: '拖到边缘分屏' };
export function TerminalPanel({
  repository,
  switching,
  onClose,
}: {
  repository?: Repository | null;
  switching: boolean;
  onClose: (s: TerminalSession) => Promise<void>;
}) {
  const store = useTerminalStore();
  const repo = repository?.id || '';
  const group = store.sessions.filter((s) => s.repositoryId === repo);
  const selected = group.find((s) => s.id === store.selected[repo]) || group.at(-1);
  const split = store.splits[repo];
  const visible = split
    ? split.ids.map((id) => group.find((s) => s.id === id)).filter((s): s is ViewSession => !!s)
    : selected
      ? [selected]
      : [];
  const panel = useRef<HTMLElement>(null),
    tabs = useRef<HTMLDivElement>(null),
    panes = useRef<HTMLDivElement>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const reason = !repository
    ? '请先选择仓库。'
    : switching
      ? '正在切换仓库，请稍候。'
      : !store.connected
        ? store.error || '正在连接终端服务…'
        : store.sessions.length >= TERMINAL_LIMITS.sessions
          ? '已达每窗口 8 个会话上限。'
          : group.some((s) => s.state === 'connecting')
            ? '正在创建会话…'
            : '';
  const canSplit = !!selected && (group.length > 1 || !reason);
  const choose = (s: ViewSession) => {
    store.select(s);
    getTerminalRuntime(s.id)?.terminal.focus();
  };
  function place(id: string, edge: DropEdge) {
    // A drop can finish after a shell exits or an SSH session is restored.
    const live = useTerminalStore.getState();
    const candidates = live.sessions.filter((s) => s.repositoryId === repo);
    const target = candidates.find((s) => s.id === id);
    if (!target || !repository) return;
    const axis: SplitAxis = edge === 'left' || edge === 'right' ? 'columns' : 'rows';
    const first = edge === 'top' || edge === 'left';
    const old = live.splits[repo];
    const others = [
      old?.axis === axis ? old.ids[first ? 1 : 0] : undefined,
      live.selected[repo],
      ...(old?.ids || []),
    ];
    let companion =
      others.map((other) => candidates.find((s) => s.id === other && s.id !== id)).find(Boolean) ||
      candidates.find((s) => s.id !== id);
    if (!companion && !reason) companion = createTerminal(repository);
    if (!companion) return;
    live.setSplit(repo, {
      axis,
      ids: first ? [id, companion.id] : [companion.id, id],
      percent: old?.axis === axis ? old.percent : 50,
    });
    choose(target);
  }
  const drag = useTerminalTabDrag(tabs, panes, store.move, place, canSplit);
  const focusTab = (id: string) =>
    requestAnimationFrame(() =>
      tabs.current
        ?.querySelector<HTMLButtonElement>(`[data-session="${CSS.escape(id)}"] [role=tab]`)
        ?.focus(),
    );
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuSession = group.find((s) => s.id === menu?.id);
  const menuIndex = group.findIndex((s) => s.id === menu?.id);
  function changeLayout(axis: SplitAxis | 'single') {
    if (!selected) return;
    if (axis === 'single') store.setSplit(repo);
    else if (split)
      store.setSplit(repo, { ...split, axis, percent: axis === split.axis ? split.percent : 50 });
    else place(selected.id, axis === 'rows' ? 'top' : 'left');
  }
  async function copy(text: string) {
    try {
      if (text) await navigator.clipboard.writeText(text);
    } catch {
      useTerminalStore.setState({ error: '无法访问剪贴板，请选中文字后手动复制。' });
    }
  }
  const minimumHeight = window.matchMedia('(max-width: 560px)').matches ? 260 : 220;
  function resize(height: number) {
    const available = panel.current?.parentElement?.parentElement?.clientHeight || 600;
    useTerminalStore.setState({
      height: Math.max(minimumHeight, Math.min(height, available - 150)),
    });
  }
  function ratio(percent: number) {
    if (split)
      store.setSplit(repo, { ...split, percent: Math.max(20, Math.min(80, Math.round(percent))) });
  }
  useEffect(() => {
    if (selected)
      tabs.current
        ?.querySelector('.is-active')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected?.id]);
  const movingSession = group.find((s) => s.id === drag.dragged);
  const drop = drag.preview?.kind === 'pane' ? drag.preview.edge : null;
  return (
    <section
      className="terminal-panel"
      id="repository-terminal"
      aria-label="仓库终端"
      ref={panel}
      data-maximized={store.maximized}
      inert={!store.visible}
    >
      {!store.maximized && (
        <div
          className="terminal-resize"
          role="separator"
          tabIndex={0}
          aria-label="调整终端高度"
          aria-orientation="horizontal"
          aria-valuemin={minimumHeight}
          aria-valuenow={store.height}
          aria-valuemax={Math.max(
            minimumHeight,
            (panel.current?.parentElement?.parentElement?.clientHeight || 900) - 150,
          )}
          onKeyDown={(e) => {
            if (!['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            resize(
              e.key === 'Home'
                ? minimumHeight
                : e.key === 'End'
                  ? 10000
                  : store.height + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 50 : 10),
            );
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.dataset.start = e.clientY + ',' + store.height;
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const [start, h] = e.currentTarget.dataset.start!.split(',').map(Number);
            resize(h + start - e.clientY);
          }}
        />
      )}
      <header className="terminal-heading">
        <strong>
          <BrandIcon className="terminal-brand" />
          终端
        </strong>
        <div role="tablist" aria-label="当前仓库终端" className="terminal-tabs" ref={tabs}>
          {group.map((s, i) => (
            <div
              key={s.id}
              data-session={s.id}
              data-tone={(s.number || 1) % 3}
              data-moving={drag.dragged === s.id}
              data-drop={
                drag.preview?.kind === 'sort' && drag.preview.marker === s.id
                  ? drag.preview.after
                    ? 'after'
                    : 'before'
                  : undefined
              }
              className={'terminal-tab' + (s.id === selected?.id ? ' is-active' : '')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={s.id === selected?.id}
                tabIndex={s.id === selected?.id ? 0 : -1}
                aria-haspopup="menu"
                aria-controls={`terminal-output-${s.id}`}
                aria-label={`${tabNumber(s)} · ${terminalName(s)} · ${terminalStateLabel(s)}`}
                title={`${terminalName(s)} · ${s.environment} · ${terminalStateLabel(s)}\n${s.initialPath}\nCtrl+C 中断 · Ctrl+Shift+F6 离开输入区`}
                onPointerDown={(e) => drag.start(e, s.id)}
                onClick={(e) => {
                  if (!drag.suppressClick.current || !e.detail) choose(s);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: s.id, x: e.clientX, y: e.clientY });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ id: s.id, x: r.left, y: r.bottom });
                    return;
                  }
                  if (!['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
                  e.preventDefault();
                  const next =
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? group.length - 1
                        : (i + (e.key === 'ArrowLeft' ? -1 : 1) + group.length) % group.length;
                  store.select(group[next]);
                  focusTab(group[next].id);
                }}
              >
                <span className="terminal-number">{tabNumber(s)}</span>
                <span className="terminal-name">{terminalName(s)}</span>
                <i className={'terminal-dot is-' + s.state} />
                {s.state !== 'running' && <span>{terminalStateLabel(s)}</span>}
              </button>
            </div>
          ))}
        </div>
        <Tooltip title={reason || '新建终端'}>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label="新建终端"
            data-terminal-new
            disabled={!!reason}
            onClick={() => repository && createTerminal(repository)}
          />
        </Tooltip>
        <div className="terminal-tools">
          <Button
            type="text"
            size="small"
            aria-label="全部终端会话"
            title="全部会话"
            icon={<UnorderedListOutlined />}
            onClick={() => useTerminalStore.setState({ allOpen: true })}
          >
            <span className="terminal-all-label">全部会话</span>
          </Button>
          <div className="terminal-views" role="group" aria-label="终端视图">
            <Dropdown
              trigger={['click']}
              menu={{
                selectable: true,
                selectedKeys: [split?.axis || 'single'],
                items: [
                  { key: 'single', label: '单窗格' },
                  { key: 'columns', label: '左右分屏' },
                  { key: 'rows', label: '上下分屏' },
                ],
                onClick: ({ key }) => changeLayout(key as SplitAxis | 'single'),
              }}
            >
              <Button
                type="text"
                size="small"
                disabled={!canSplit}
                aria-label="分屏布局"
                title="分屏布局"
                icon={<LayoutOutlined />}
              />
            </Dropdown>
            <Button
              type="text"
              size="small"
              title={store.maximized ? '还原终端' : '最大化终端'}
              aria-label={store.maximized ? '还原终端' : '最大化终端'}
              icon={store.maximized ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={() => useTerminalStore.setState({ maximized: !store.maximized })}
            />
            <Button
              type="text"
              size="small"
              title="收起终端 · Ctrl+`"
              aria-label="收起终端"
              icon={<DownOutlined />}
              onClick={() => {
                useTerminalStore.setState({ visible: false });
                document.querySelector<HTMLButtonElement>('[data-terminal-toggle]')?.focus();
              }}
            />
          </div>
        </div>
      </header>
      {menu && menuSession && (
        <Dropdown
          key={menu.id + ':' + menu.x + ':' + menu.y}
          open
          trigger={['contextMenu']}
          autoFocus
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
          menu={{
            'aria-label': terminalName(menuSession) + ' 的标签菜单',
            items: [
              { key: 'rename', label: '重命名' },
              { key: 'left', label: '向左移动', disabled: menuIndex === 0 },
              { key: 'right', label: '向右移动', disabled: menuIndex === group.length - 1 },
              { type: 'divider' },
              { key: 'columns', label: '左右分屏', disabled: !canSplit },
              { key: 'rows', label: '上下分屏', disabled: !canSplit },
              { type: 'divider' },
              {
                key: 'copy',
                label: '复制选区',
                disabled: !getTerminalRuntime(menu.id)?.terminal.hasSelection(),
              },
              { key: 'path', label: '复制启动目录' },
              {
                key: 'paste',
                label: '粘贴',
                disabled: menuSession.state !== 'running' || menuSession.readOnly,
              },
              { type: 'divider' },
              {
                key: 'close',
                danger: true,
                label: menuSession.state === 'connecting' ? '取消创建终端' : '关闭会话…',
              },
            ],
            onKeyDown: (e) => {
              if (['Escape', 'Tab'].includes(e.key)) {
                e.preventDefault();
                setMenu(null);
                focusTab(menu.id);
              }
            },
            onClick: ({ key }) => {
              setMenu(null);
              switch (key) {
                case 'rename':
                  setRename({ id: menu.id, name: terminalName(menuSession) });
                  break;
                case 'left':
                case 'right':
                  store.move(menu.id, menuIndex + (key === 'left' ? -1 : 1));
                  focusTab(menu.id);
                  break;
                case 'columns':
                case 'rows':
                  place(menu.id, key === 'columns' ? 'left' : 'top');
                  break;
                case 'copy':
                  void copy(getTerminalRuntime(menu.id)?.terminal.getSelection() || '');
                  break;
                case 'path':
                  void copy(menuSession.initialPath);
                  break;
                case 'paste':
                  void pasteTerminal(menu.id);
                  break;
                case 'close':
                  void onClose(menuSession);
                  break;
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
      {rename && (
        <AluneModal
          open
          size="sm"
          title="重命名终端"
          initialFocus="field"
          okText="保存"
          okDisabled={!rename.name.trim()}
          onCancel={() => {
            setRename(null);
            focusTab(rename.id);
          }}
          onOk={() => {
            store.rename(rename.id, rename.name);
            setRename(null);
            focusTab(rename.id);
          }}
        >
          <Input
            aria-label="会话名称"
            data-autofocus
            value={rename.name}
            maxLength={48}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setRename({ ...rename, name: e.target.value })}
          />
        </AluneModal>
      )}
      {store.error && (
        <div className="terminal-notice" role="status">
          {store.error}
        </div>
      )}
      <div
        ref={panes}
        className="terminal-panes"
        data-axis={split?.axis || 'single'}
        style={
          {
            '--portion': (split?.percent || 50) + '%',
            '--drop-portion':
              (split?.axis === (drop === 'top' || drop === 'bottom' ? 'rows' : 'columns')
                ? split.percent
                : 50) + '%',
          } as CSSProperties
        }
      >
        {visible.map((s, i) => (
          <Fragment key={s.id}>
            {i === 1 && split && (
              <div
                className="terminal-divider"
                role="separator"
                tabIndex={0}
                aria-label="调整分屏比例"
                aria-orientation={split.axis === 'rows' ? 'horizontal' : 'vertical'}
                aria-valuenow={split.percent}
                aria-valuemin={20}
                aria-valuemax={80}
                onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const r = panes.current!.getBoundingClientRect();
                  ratio(
                    100 *
                      (split.axis === 'rows'
                        ? (e.clientY - r.top) / r.height
                        : (e.clientX - r.left) / r.width),
                  );
                }}
                onKeyDown={(e) => {
                  const keys =
                    split.axis === 'rows' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
                  if (keys.includes(e.key)) {
                    e.preventDefault();
                    ratio(split.percent + (e.key === keys[0] ? -5 : 5));
                  }
                }}
              />
            )}
            <TerminalPane session={s} active={selected?.id === s.id} split={!!split} />
          </Fragment>
        ))}
        {!visible.length && (
          <div className="terminal-empty">
            <BrandIcon className="terminal-brand" />
            <strong>在 {repository?.name || '仓库'} 中打开终端</strong>
            <p>{reason || repository?.path}</p>
            <Button disabled={!!reason} onClick={() => repository && createTerminal(repository)}>
              新建终端
            </Button>
          </div>
        )}
        {drop && movingSession && (
          <div className="terminal-drop" data-edge={drop} aria-hidden>
            <span>
              {drop === 'center'
                ? edges.center
                : `${terminalName(movingSession)} · 放到${edges[drop]}`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
