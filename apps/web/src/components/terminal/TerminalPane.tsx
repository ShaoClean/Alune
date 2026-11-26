import { useLayoutEffect, useRef } from 'react';
import { useAppearance } from '../../appearance';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { fitTerminal, getTerminalRuntime } from '../../stores/terminalStore';
import {
  tabNumber,
  terminalName,
  useTerminalStore,
  type ViewSession,
} from '../../stores/terminalState';

export function TerminalPane({
  session,
  active,
  split,
}: {
  session: ViewSession;
  active: boolean;
  split: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const visible = useTerminalStore((state) => state.visible);
  const mode = useAppearance((state) => state.theme);
  const preferences = useWorkspaceStore((state) => state.codeAppearance);
  const runtime = getTerminalRuntime(session.id);
  useLayoutEffect(() => {
    const element = host.current;
    if (!runtime || !element) return;
    element.appendChild(runtime.element);
    fitTerminal(session.id);
    const observer = new ResizeObserver(() => fitTerminal(session.id));
    observer.observe(element);
    return () => {
      observer.disconnect();
      runtime.element.remove();
    };
  }, [runtime, session.id]);
  useLayoutEffect(() => {
    if (
      active &&
      visible &&
      !document.querySelector('.ant-modal-wrap:not([style*="display: none"]), dialog:modal')
    )
      runtime?.terminal.focus();
  }, [active, visible, runtime]);
  useLayoutEffect(() => {
    if (!runtime) return;
    runtime.terminal.options.fontFamily = `"${preferences.fontFamily}", "Geist Mono Variable", monospace`;
    runtime.terminal.options.fontSize = preferences.fontSize;
    runtime.terminal.options.theme =
      mode === 'dark'
        ? {
            background: '#28212f',
            foreground: '#d7deeb',
            cursor: '#d0a5f4',
            selectionBackground: '#51405f',
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
            background: '#fffdfd',
            foreground: '#293347',
            cursor: '#7549a3',
            selectionBackground: '#e7d7f3',
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
    fitTerminal(session.id);
  }, [runtime, session.id, mode, preferences.fontFamily, preferences.fontSize]);
  const select = () => {
    if (!active) useTerminalStore.getState().select(session);
  };
  return (
    <section
      className="terminal-pane"
      data-active={active}
      onFocusCapture={select}
      onPointerDown={select}
      role="tabpanel"
      id={`terminal-output-${session.id}`}
      aria-label={terminalName(session)}
    >
      {split && (
        <div className="terminal-pane-name">
          {tabNumber(session)} · {terminalName(session)}
        </div>
      )}
      {(session.error || session.inputError || session.readOnly) && (
        <div className="terminal-notice" role="status">
          {session.error || session.inputError || '只读会话 · 输入和尺寸由控制窗口管理。'}
        </div>
      )}
      {session.truncated && (
        <div className="terminal-truncated" role="status">
          较早输出已截断（最多 10,000 行 / 2 MiB）。
        </div>
      )}
      <div className="terminal-output" ref={host} />
    </section>
  );
}
