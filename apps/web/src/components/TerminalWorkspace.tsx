import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Button, Tooltip, AluneModal, useAluneConfirm } from '@alune/ui';
import {
  CodeOutlined,
  PlusOutlined,
  CloseOutlined,
  CopyOutlined,
  MinusOutlined,
  ExpandOutlined,
  CompressOutlined,
  UnorderedListOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { Repository, TerminalSession } from '@alune/shared';
import { TERMINAL_LIMITS, terminalNeedsConfirmation } from '@alune/shared';
import {
  useTerminalStore,
  connectTerminals,
  createTerminal,
  closeTerminal,
  getTerminalRuntime,
  fitTerminal,
  terminalStateLabel,
  pasteTerminal,
  setTerminalPasteConfirmation,
} from '../stores/terminalStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAppearance } from '../appearance';
import { registerTerminalRemovalConfirmation } from '../stores/terminalRemoval';
import '@xterm/xterm/css/xterm.css';
import '../terminal.css';

const closingDescription = '会话不可恢复，文件改动不会回滚。脱离会话的远端任务可能继续运行。';

export function TerminalWorkspace({
  slot,
  repository,
  switching,
}: {
  slot: HTMLDivElement | null;
  repository?: Repository | null;
  switching: boolean;
}) {
  const store = useTerminalStore();
  const confirm = useAluneConfirm();
  const navigate = useNavigate();
  useEffect(connectTerminals, []);
  useEffect(
    () =>
      window.aluneTerminal?.onShutdownRequested(async ({ requestId, sessions }) => {
        const confirmed = await confirm({
          level: 2,
          title: `关闭 ${sessions.length} 个终端并退出？`,
          description: closingDescription,
          content: <SessionSummary sessions={sessions} />,
          acknowledge: '我了解会话不可恢复，并确认关闭全部会话',
          okText: '关闭全部会话',
        });
        window.aluneTerminal?.respondToShutdown(requestId, confirmed);
      }),
    [confirm],
  );
  useEffect(() => {
    setTerminalPasteConfirmation((text) =>
      confirm({
        level: 1,
        title: '粘贴多行命令？',
        description: '粘贴内容可能立即执行，请先核对。',
        content: <pre className="terminal-paste-preview">{text.slice(0, 2000)}</pre>,
        okText: '粘贴',
        initialFocus: 'cancel',
      }),
    );
    registerTerminalRemovalConfirmation((sessions) =>
      confirm({
        level: 2,
        title: `关闭 ${sessions.length} 个终端并继续移除？`,
        description: closingDescription,
        content: <SessionSummary sessions={sessions} />,
        acknowledge: '我了解会话不可恢复，并确认关闭这些会话',
        okText: '关闭并继续移除',
      }),
    );
    return () => {
      setTerminalPasteConfirmation();
      registerTerminalRemovalConfirmation();
    };
  }, [confirm]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.defaultPrevented ||
        !event.ctrlKey ||
        event.code !== 'Backquote'
      )
        return;
      event.preventDefault();
      useTerminalStore.getState().toggle();
      if (!useTerminalStore.getState().visible)
        document.querySelector<HTMLButtonElement>('[data-terminal-toggle]')?.focus();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (useTerminalStore.getState().sessions.some(terminalNeedsConfirmation)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('keydown', shortcut);
    // Electron confirms shutdown in the main process (also works after renderer failure).
    if (!window.aluneWorkspace) window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', shortcut);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  const close = async (session: TerminalSession) => {
    if (
      session.state === 'running' &&
      !(await confirm({
        level: 2,
        title: '关闭终端会话？',
        description: closingDescription,
        content: <SessionSummary sessions={[session]} />,
        acknowledge: '我了解会话不可恢复，并确认关闭',
        okText: '关闭会话',
      }))
    )
      return;
    try {
      await closeTerminal(session);
    } catch (error) {
      useTerminalStore.setState({ error: error instanceof Error ? error.message : '关闭失败。' });
    }
  };
  return (
    <>
      {slot &&
        store.visible &&
        createPortal(
          <TerminalPanel repository={repository} switching={switching} onClose={close} />,
          slot,
        )}
      <AluneModal
        open={store.allOpen}
        title="全部终端会话"
        description="切换仓库、收起面板和关闭仓库标签均保留会话。"
        onCancel={() => useTerminalStore.setState({ allOpen: false })}
        footer={null}
      >
        {!store.sessions.length ? (
          <p>暂无终端。请先打开仓库，再从工具栏选择“终端”。</p>
        ) : (
          <ul className="terminal-all-sessions">
            {store.sessions.map((session, index) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const repo = useRepositoryStore
                        .getState()
                        .repositories.find((repo) => repo.id === session.repositoryId);
                      if (!repo) throw new Error('仓库登记已移除，请关闭此终端记录。');
                      useRepositoryStore.getState().openRepository(repo);
                      store.select(session);
                      useTerminalStore.setState({ allOpen: false });
                      navigate(`/repositories/${repo.id}`);
                    } catch (error) {
                      useTerminalStore.setState({ error: String(error) });
                    }
                  }}
                >
                  <strong>
                    终端 {index + 1} · {session.repositoryName}
                  </strong>
                  <span>
                    {session.environment} · {terminalStateLabel(session)}
                  </span>
                  <code title={session.initialPath}>{session.initialPath}</code>
                </button>
                <Button
                  type="text"
                  aria-label={`关闭会话 ${index + 1}`}
                  icon={<CloseOutlined />}
                  onClick={() => void close(session)}
                />
              </li>
            ))}
          </ul>
        )}
        {store.error && <p role="status">{store.error}</p>}
      </AluneModal>
    </>
  );
}

function SessionSummary({ sessions }: { sessions: TerminalSession[] }) {
  return (
    <ul className="terminal-session-summary">
      {sessions.map((session) => (
        <li key={session.id}>
          <strong>
            {session.repositoryName} · {session.environment}
          </strong>
          <code>{session.initialPath}</code>
        </li>
      ))}
    </ul>
  );
}

function TerminalPanel({
  repository,
  switching,
  onClose,
}: {
  repository?: Repository | null;
  switching: boolean;
  onClose: (session: TerminalSession) => Promise<void>;
}) {
  const store = useTerminalStore();
  const group = store.sessions.filter((session) => session.repositoryId === repository?.id);
  const selected =
    group.find((session) => session.id === store.selected[repository?.id || '']) || group.at(-1);
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const mode = useAppearance((state) => state.theme);
  const preferences = useWorkspaceStore((state) => state.codeAppearance);
  const creating = group.some((session) => session.state === 'connecting');
  const reason = !repository
    ? '请先选择仓库。'
    : switching
      ? '正在切换仓库，请稍候。'
      : !store.connected
        ? store.error || '正在连接终端服务…'
        : store.sessions.length >= TERMINAL_LIMITS.sessions
          ? '已达每窗口 8 个会话上限，请先关闭不需要的会话。'
          : creating
            ? '正在创建会话，可取消后重试。'
            : '';
  useLayoutEffect(() => {
    const runtime = selected && getTerminalRuntime(selected.id);
    if (!runtime || !host.current) return;
    host.current.appendChild(runtime.element);
    fitTerminal(selected.id);
    runtime.terminal.focus();
    const observer = new ResizeObserver(() => fitTerminal(selected.id));
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      runtime.element.remove();
    };
  }, [selected?.id]);
  useLayoutEffect(() => {
    const runtime = selected && getTerminalRuntime(selected.id);
    if (!runtime) return;
    runtime.terminal.options.fontFamily = `"${preferences.fontFamily}", "Geist Mono Variable", monospace`;
    runtime.terminal.options.fontSize = preferences.fontSize;
    runtime.terminal.options.theme =
      mode === 'dark'
        ? {
            background: '#171c27',
            foreground: '#d7deeb',
            cursor: '#a9c7ff',
            selectionBackground: '#345076',
            black: '#465166',
            red: '#f29191',
            green: '#9bd5b2',
            yellow: '#ebcb8b',
            blue: '#94b9ff',
            magenta: '#cbb4ef',
            cyan: '#8fd3de',
            white: '#e4eaf4',
            brightBlack: '#8792a8',
            brightRed: '#ffb0ac',
            brightGreen: '#b0eac0',
            brightYellow: '#f5dca4',
            brightBlue: '#bbd1ff',
            brightMagenta: '#e3c7ff',
            brightCyan: '#b0e7ed',
            brightWhite: '#ffffff',
          }
        : {
            background: '#f7f9fc',
            foreground: '#293347',
            cursor: '#315eb7',
            selectionBackground: '#c8daf6',
            black: '#344055',
            red: '#ad343f',
            green: '#276742',
            yellow: '#7b5b14',
            blue: '#2f59a7',
            magenta: '#79509b',
            cyan: '#236b79',
            white: '#65738b',
            brightBlack: '#61708a',
            brightRed: '#a6313c',
            brightGreen: '#235e3e',
            brightYellow: '#765611',
            brightBlue: '#284d99',
            brightMagenta: '#73428e',
            brightCyan: '#226271',
            brightWhite: '#293347',
          };
    fitTerminal(selected.id);
  }, [selected?.id, mode, preferences.fontFamily, preferences.fontSize]);

  const resize = (height: number) => {
    const available = panel.current?.parentElement?.parentElement?.clientHeight || 600;
    useTerminalStore.setState({
      height: Math.max(160, Math.min(height, Math.max(160, available - 150))),
    });
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      useTerminalStore.setState({ error: '无法访问剪贴板，请选中文字后手动复制。' });
    }
  };
  return (
    <section
      ref={panel}
      id="repository-terminal"
      className="terminal-panel"
      aria-label="仓库终端"
      data-maximized={store.maximized}
      style={{ '--terminal-height': `${store.height}px` } as CSSProperties}
    >
      <div
        className="terminal-resize"
        role="separator"
        tabIndex={0}
        aria-label="调整终端高度"
        aria-orientation="horizontal"
        aria-valuemin={160}
        aria-valuemax={panel.current?.parentElement?.parentElement?.clientHeight || 900}
        aria-valuenow={store.height}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          resize(
            event.key === 'Home'
              ? 160
              : event.key === 'End'
                ? 10000
                : store.height + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 50 : 10),
          );
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.dataset.start = `${event.clientY},${store.height}`;
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const [start, height] = event.currentTarget.dataset.start!.split(',').map(Number);
          resize(height + start - event.clientY);
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      />
      <header className="terminal-heading">
        <strong>
          <CodeOutlined /> 终端
        </strong>
        <span className="terminal-heading__spacer" />
        <Tooltip title={reason || '在当前仓库新建终端'}>
          <Button
            data-terminal-new
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label="新建终端"
            disabled={!!reason}
            onClick={() => repository && void createTerminal(repository)}
          >
            新建
          </Button>
        </Tooltip>
        <Button
          type="text"
          size="small"
          icon={<UnorderedListOutlined />}
          aria-label="全部终端会话"
          title="全部会话"
          onClick={() => useTerminalStore.setState({ allOpen: true })}
        />
        <Button
          type="text"
          size="small"
          icon={store.maximized ? <CompressOutlined /> : <ExpandOutlined />}
          aria-label={store.maximized ? '还原终端' : '最大化终端'}
          title={store.maximized ? '还原终端' : '最大化终端'}
          onClick={() => useTerminalStore.setState({ maximized: !store.maximized })}
        />
        <Button
          type="text"
          size="small"
          icon={<MinusOutlined />}
          aria-label="收起终端"
          title="收起终端 · Ctrl+`"
          onClick={() => {
            useTerminalStore.setState({ visible: false });
            document.querySelector<HTMLButtonElement>('[data-terminal-toggle]')?.focus();
          }}
        />
      </header>
      {!!group.length && (
        <div
          className="terminal-tabs"
          role="tablist"
          aria-label="当前仓库终端"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const index = group.findIndex((session) => session.id === selected?.id);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? group.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + group.length) % group.length;
            event.preventDefault();
            store.select(group[next]);
          }}
        >
          {group.map((session, index) => (
            <div
              key={session.id}
              className={session.id === selected?.id ? 'terminal-tab is-active' : 'terminal-tab'}
            >
              <button
                type="button"
                role="tab"
                aria-selected={session.id === selected?.id}
                tabIndex={session.id === selected?.id ? 0 : -1}
                aria-controls={`terminal-output-${session.id}`}
                onClick={() => store.select(session)}
              >
                {session.state === 'running' ? (
                  <CheckCircleOutlined />
                ) : session.state === 'connecting' ? (
                  <LoadingOutlined />
                ) : (
                  <WarningOutlined />
                )}
                终端 {index + 1} <span>{terminalStateLabel(session)}</span>
              </button>
              <button
                type="button"
                aria-label={
                  session.state === 'connecting' ? '取消创建终端' : `关闭终端 ${index + 1}`
                }
                onClick={() => void onClose(session)}
              >
                <CloseOutlined />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="terminal-identity">
        <span title={selected?.environment}>
          {selected?.environment || (repository?.source === 'local' ? 'Alune 服务主机' : 'SSH')} ·{' '}
          {selected?.repositoryName || repository?.name || '未选仓库'}
        </span>
        {selected && (
          <span className={`terminal-state is-${selected.state}`} role="status">
            {terminalStateLabel(selected)}
          </span>
        )}
      </div>
      <div className="terminal-path">
        <span>启动目录</span>
        <code title={selected?.initialPath || repository?.path}>
          {selected?.initialPath || repository?.path || '—'}
        </code>
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          aria-label="复制启动目录"
          disabled={!repository}
          onClick={() => void copy(selected?.initialPath || repository?.path || '')}
        />
      </div>
      {(selected?.error || selected?.inputError || store.error) && (
        <div className="terminal-notice" role="status">
          {selected?.error || selected?.inputError || store.error}
        </div>
      )}
      {selected?.truncated && (
        <div className="terminal-truncated" role="status">
          较早输出已截断（最多 10,000 行 / 2 MiB）。
        </div>
      )}
      {selected ? (
        <div
          className="terminal-output"
          id={`terminal-output-${selected.id}`}
          role="tabpanel"
          aria-label="终端输出"
          ref={host}
        />
      ) : (
        <div className="terminal-empty">
          <CodeOutlined />
          <strong>此仓库还没有终端</strong>
          <p>{reason || '在上方启动目录打开交互式 shell。'}</p>
          <Button disabled={!!reason} onClick={() => repository && void createTerminal(repository)}>
            新建终端
          </Button>
        </div>
      )}
      <footer className="terminal-footnote">
        <span>Ctrl+C 中断 · Ctrl+Shift+F6 离开输入区</span>
        {selected && (
          <>
            <button
              type="button"
              onClick={() => {
                const runtime = getTerminalRuntime(selected.id);
                if (runtime) void copy(runtime.terminal.getSelection());
              }}
            >
              复制选区
            </button>
            <button
              type="button"
              disabled={selected.state !== 'running'}
              onClick={() => void pasteTerminal(selected.id)}
            >
              粘贴
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
