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
