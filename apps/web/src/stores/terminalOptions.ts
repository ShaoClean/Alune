import type { Terminal } from '@xterm/xterm';
import type { TerminalSession } from '@alune/domain';

export function applyTerminalHostOptions(
  terminal: Pick<Terminal, 'options'>,
  session: Pick<TerminalSession, 'windowsPty'>,
) {
  // ConPTY redraws the viewport after resize. xterm must retain scrollback
  // instead of pulling it into that viewport where the redraw would erase it.
  terminal.options.windowsPty = session.windowsPty ?? {};
}

export function synchronizeTerminalSize(
  terminal: Pick<Terminal, 'cols' | 'rows'>,
  fit: () => void,
  resize: (cols: number, rows: number) => void,
) {
  const { cols, rows } = terminal;
  fit();
  // A retained renderer may have fitted while the PTY was still connecting.
  // xterm emits no resize event for unchanged dimensions, so synchronize the
  // newly running execution host even when this fit is a renderer-side no-op.
  // A changed fit already dispatches through xterm's onResize listener.
  if (terminal.cols === cols && terminal.rows === rows) resize(cols, rows);
}
