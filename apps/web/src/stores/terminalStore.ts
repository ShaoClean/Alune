import { useTerminalStore } from './terminalState';
import type { ViewSession } from './terminalState';
export { useTerminalStore, terminalStateLabel } from './terminalState';
import { io, type Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TERMINAL_LIMITS, terminalNeedsConfirmation } from '@alune/shared';
import type { Repository, TerminalOutput, TerminalReply, TerminalSession } from '@alune/shared';
import { useWorkspaceStore } from './workspaceStore';
import { retainedTerminalLines } from './terminalHistory';

type Runtime = {
  terminal: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  lines: number;
  sequence: number;
};
const runtimes = new Map<string, Runtime>();
let socket: Socket | undefined;
let references = 0;
const patch = (id: string, update: Partial<ViewSession>) =>
  useTerminalStore.setState((state) => ({
    sessions: state.sessions.map((session) =>
      session.id === id ? { ...session, ...update } : session,
    ),
  }));
const report = (error: unknown) =>
  useTerminalStore.setState({
    error: error instanceof Error ? error.message : String(error),
  });

async function request<T = undefined>(event: string, payload: unknown): Promise<T> {
  if (!socket?.connected) throw new Error('终端连接不可用。请检查连接后重试。');
  const reply = (await socket.timeout(10_000).emitWithAck(event, payload)) as TerminalReply<T>;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export function connectTerminals() {
  references++;
  if (!socket) {
    socket = io('/terminal', { transports: ['websocket'], reconnection: true });
    socket.on('connect', () => useTerminalStore.setState({ connected: true, error: '' }));
    socket.on('connect_error', (error: Error) => {
      useTerminalStore.setState({ connected: false });
      report(error);
    });
    socket.on('disconnect', () => {
      useTerminalStore.setState((state) => ({
        connected: false,
        sessions: state.sessions.map((session) =>
          terminalNeedsConfirmation(session)
            ? {
                ...session,
                state: 'disconnected',
                error: '连接已断开，旧会话不会恢复。请显式新建会话。',
              }
            : session,
        ),
      }));
      for (const runtime of runtimes.values()) runtime.terminal.options.disableStdin = true;
    });
    socket.on('terminal:state', (info: TerminalSession) => {
      // Only locally requested sessions may become visible in this window.
      if (!useTerminalStore.getState().sessions.some((item) => item.id === info.id)) return;
      patch(info.id, info);
      const runtime = ensureRuntime(info.id);
      runtime.terminal.options.disableStdin = info.state !== 'running';
      if (info.state === 'running') fitTerminal(info.id);
    });
    socket.on('terminal:removed', ({ sessionId }: { sessionId: string }) => removeLocal(sessionId));
    socket.on('terminal:output', (packet: TerminalOutput) => {
      const runtime = runtimes.get(packet.sessionId);
      const transport = socket;
      const connectionId = transport?.id;
      if (!runtime || packet.sequence <= runtime.sequence) return;
      runtime.sequence = packet.sequence;
      // The parser runs even when its DOM is detached. ACK only after parsing:
      // server output is bounded while a hidden/slow renderer catches up.
      runtime.terminal.write(packet.data, () => {
        if (runtimes.get(packet.sessionId) !== runtime) return;
        runtime.lines += (packet.data.match(/\n/g) || []).length;
        {
          const terminal = runtime.terminal;
          const buffer = terminal.buffer.active;
          const retained = retainedTerminalLines(
            buffer.length,
            (index) => buffer.getLine(index)?.translateToString(true) || '',
          );
          if (retained < buffer.length) {
            if (buffer.type === 'normal' && retained >= terminal.rows) {
              terminal.options.scrollback = Math.max(0, retained - terminal.rows);
              terminal.options.scrollback = TERMINAL_LIMITS.historyLines - 200;
            } else {
              // Pathological output can fill a single cell with combining marks.
              // Clear that viewport too instead of keeping an oversized live line.
              terminal.reset();
            }
            patch(packet.sessionId, { truncated: true });
          }
        }
        if (
          runtime.lines >= TERMINAL_LIMITS.historyLines ||
          runtime.terminal.buffer.normal.length >=
            TERMINAL_LIMITS.historyLines - 200 + runtime.terminal.rows
        ) {
          patch(packet.sessionId, { truncated: true });
        }
        if (transport?.connected && transport.id === connectionId)
          transport.emit('terminal:ack', {
            sessionId: packet.sessionId,
            sequence: packet.sequence,
          });
      });
    });
  }
  return () => {
    references--;
    // React StrictMode immediately reattaches effects; do not kill its shells.
    queueMicrotask(() => {
      if (!references) {
        socket?.disconnect();
        socket = undefined;
      }
    });
  };
}

function ensureRuntime(id: string): Runtime {
  const existing = runtimes.get(id);
  if (existing) return existing;
  const preferences = useWorkspaceStore.getState().codeAppearance;
  const terminal = new Terminal({
    cols: 80,
    rows: 24,
    cursorBlink: false,
    disableStdin: true,
    allowProposedApi: false,
    scrollback: TERMINAL_LIMITS.historyLines - 200,
    fontFamily: `"${preferences.fontFamily}", "Geist Mono Variable", monospace`,
    fontSize: preferences.fontSize,
    screenReaderMode: true,
    allowTransparency: false,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  const element = document.createElement('div');
  element.className = 'terminal-emulator';
  const runtime = { terminal, fit, element, lines: 0, sequence: 0 };
  runtimes.set(id, runtime);
  terminal.open(element);
  terminal.onData((data) => {
    void request('terminal:input', { sessionId: id, data })
      .then(() => patch(id, { inputError: undefined }))
      .catch((error) => patch(id, { inputError: error.message }));
  });
  terminal.onResize(({ cols, rows }) => {
    if (
      useTerminalStore.getState().sessions.find((session) => session.id === id)?.state === 'running'
    )
      void request('terminal:resize', { sessionId: id, cols, rows }).catch(report);
  });
  // Tab belongs to the shell. Ctrl+Shift+F6 is the documented escape hatch.
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.isComposing) return true;
    if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.key === 'F6') {
      event.preventDefault();
      document.querySelector<HTMLButtonElement>('[data-terminal-new]')?.focus();
      return false;
    }
    if (event.ctrlKey && event.code === 'Backquote') return false;
    if (event.type === 'keydown' && (event.metaKey || (event.ctrlKey && event.shiftKey))) {
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        const selection = terminal.getSelection();
        if (selection) void navigator.clipboard.writeText(selection).catch(report);
        return false;
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        void pasteTerminal(id);
        return false;
      }
    }
    return true;
  });
  // Let the shell receive Ctrl+B etc. without the workspace stealing the key.
  element.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey && event.code === 'Backquote')) event.stopPropagation();
  });
  element.addEventListener(
    'paste',
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void pasteTerminal(id, event.clipboardData?.getData('text/plain') || '');
    },
    true,
  );
  return runtime;
}

let confirmPaste: ((text: string) => Promise<boolean>) | undefined;
export function setTerminalPasteConfirmation(confirm?: (text: string) => Promise<boolean>) {
  confirmPaste = confirm;
}
export async function pasteTerminal(id: string, value?: string) {
  try {
    const runtime = runtimes.get(id);
    if (
      !runtime ||
      useTerminalStore.getState().sessions.find((item) => item.id === id)?.state !== 'running'
    )
      return;
    const text = value ?? (await navigator.clipboard.readText());
    if (!text) return;
    if (new TextEncoder().encode(text).length > TERMINAL_LIMITS.inputBytes - 12)
      throw new Error('一次最多粘贴 16 KiB，请分批粘贴。');
    if (/[\r\n]/.test(text) && !(await confirmPaste?.(text))) return;
    // xterm adds bracketed-paste markers when the application has enabled them.
    runtime.terminal.paste(text);
    runtime.terminal.focus();
  } catch (error) {
    report(error);
  }
}

export function getTerminalRuntime(id: string) {
  return runtimes.get(id);
}
export function fitTerminal(id: string) {
  const runtime = runtimes.get(id);
  if (
    !runtime?.element.isConnected ||
    !runtime.element.clientHeight ||
    !runtime.element.clientWidth
  )
    return;
  const size = runtime.fit.proposeDimensions();
  if (size)
    runtime.terminal.resize(
      Math.max(2, Math.min(500, size.cols)),
      Math.max(1, Math.min(200, size.rows)),
    );
}
export async function createTerminal(repo: Repository) {
  const state = useTerminalStore.getState();
  if (
    state.sessions.length >= TERMINAL_LIMITS.sessions ||
    state.sessions.some((item) => item.repositoryId === repo.id && item.state === 'connecting')
  )
    return;
  const id = crypto.randomUUID();
  const info: ViewSession = {
    id,
    requestId: id,
    repositoryId: repo.id,
    repositoryName: repo.name,
    initialPath: repo.path,
    source: repo.source || 'ssh',
    connectionId: repo.connectionId,
    environment: repo.source === 'local' ? 'Alune 服务主机' : 'SSH',
    state: 'connecting',
    createdAt: Date.now(),
  };
  ensureRuntime(id);
  useTerminalStore.setState((state) => ({
    sessions: [...state.sessions, info],
    error: '',
    visible: true,
    selected: { ...state.selected, [repo.id]: id },
  }));
  try {
    await request<TerminalSession>('terminal:create', {
      repositoryId: repo.id,
      requestId: id,
      cols: 80,
      rows: 24,
    });
  } catch (error) {
    patch(id, {
      state: 'failed',
      error: error instanceof Error ? error.message : '终端启动失败。',
    });
    // A timed-out ACK is not proof that creation failed on the server.
    if (socket?.connected) socket.emit('terminal:close', { sessionId: id, confirmed: true });
  }
}
function removeLocal(id: string) {
  runtimes.get(id)?.terminal.dispose();
  runtimes.get(id)?.element.remove();
  runtimes.delete(id);
  useTerminalStore.setState((state) => ({
    sessions: state.sessions.filter((session) => session.id !== id),
    selected: Object.fromEntries(
      Object.entries(state.selected).filter(([, value]) => value !== id),
    ),
  }));
}
export async function closeTerminal(session: TerminalSession) {
  if (socket?.connected) {
    try {
      await request('terminal:close', { sessionId: session.id, confirmed: true });
    } catch (error) {
      if (terminalNeedsConfirmation(session)) throw error;
      // Socket disconnect already destroyed these sessions on the server.
    }
  }
  removeLocal(session.id);
}
