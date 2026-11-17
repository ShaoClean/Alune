import { sshTerminalEnvironment } from '@alune/domain';
import type { AgentClient } from '@alune/agent-client';
import type { JsonValue } from '@alune/protocol';
import { uiAgent } from '../api/ui-agent';
import { observeOwners, repositoryTarget } from '../api/agent-workspace';
import { useTerminalStore } from './terminalState';
import type { ViewSession } from './terminalState';
export { useTerminalStore, terminalStateLabel } from './terminalState';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TERMINAL_LIMITS, terminalNeedsConfirmation } from '@alune/domain';
import type { Repository, TerminalOutput, TerminalSession } from '@alune/domain';
import { useWorkspaceStore } from './workspaceStore';
import { retainedTerminalLines } from './terminalHistory';
import { applyTerminalHostOptions, synchronizeTerminalSize, handleTerminalNavigationKey } from './terminalOptions';

type Runtime = {
  terminal: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  lines: number;
  sequence: number;
  closing?: Promise<void>;
};
const runtimes = new Map<string, Runtime>();
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

const owners = new Map<string, AgentClient>();
let workspaceEnd: (() => void) | undefined;
function activeTransport(id: string) {
  return owners.get(id)?.initialized?.sessionId;
}
function connected(id: string) {
  return owners.get(id)?.state === 'ready';
}
async function request<T = undefined>(event: string, payload: unknown): Promise<T> {
  if (uiAgent) {
    const command = event.slice('terminal:'.length);
    const body = payload as { sessionId: string; repositoryId: string; requestId: string };
    if (command === 'create') {
      const { repositoryId, ...input } = body;
      const { client, resource, alias, terminalEnvironment } = await repositoryTarget(repositoryId);
      if (alias.source === 'ssh') {
        // Older brokers omit the public display label from their catalog.
        const profile =
          !terminalEnvironment &&
          (await uiAgent.listHostProfiles()).hosts.find((host) => host.id === alias.connectionId);
        patch(body.requestId, {
          environment: terminalEnvironment || (profile ? sshTerminalEnvironment(profile) : 'SSH'),
        });
      }
      owners.set(body.requestId, client);
      return (await client.request('terminals.create', {
        ...input,
        resource: { ...resource },
      })) as T;
    }
    const owner = owners.get(body.sessionId);
    if (!owner || owner.state !== 'ready') throw new Error('终端连接已断开。');
    return (await owner.request('terminals.' + command, payload as JsonValue, {
      timeoutMs: 10000,
    })) as T;
  }
  throw new Error('Agent 尚未连接，终端不可用。');
}

const stateEvent = (info: TerminalSession) => {
  // Only locally requested sessions may become visible in this window.
  if (!useTerminalStore.getState().sessions.some((item) => item.id === info.id)) return;
  patch(info.id, info);
  const runtime = ensureRuntime(info.id);
  applyTerminalHostOptions(runtime.terminal, info);
  runtime.terminal.options.disableStdin = info.state !== 'running';
  if (info.state === 'running')
    synchronizeTerminalSize(runtime.terminal, () => fitTerminal(info.id), (cols, rows) => {
      void request('terminal:resize', { sessionId: info.id, cols, rows }).catch(report);
    });
};
const outputEvent = (packet: TerminalOutput) => {
  const runtime = runtimes.get(packet.sessionId);
  const connectionId = activeTransport(packet.sessionId);
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
    if (connected(packet.sessionId) && activeTransport(packet.sessionId) === connectionId)
      void request('terminal:ack', {
        sessionId: packet.sessionId,
        sequence: packet.sequence,
      }).catch(async (error) => {
        // A parser ACK can cross the confirmed close on its way to the Agent.
        // Only surface errors belonging to a session that is still open.
        await runtime.closing?.catch(() => {});
        if (
          runtimes.get(packet.sessionId) === runtime &&
          activeTransport(packet.sessionId) === connectionId
        )
          report(error);
      });
  });
};
export function connectTerminals() {
  references++;
  if (uiAgent && !workspaceEnd) {
    const disposers = new Set<() => void>();
    const detach = observeOwners((client) => {
      if (client.state !== 'ready') return;
      if (client === uiAgent) useTerminalStore.setState({ connected: true, error: '' });
      const off = client.onEvent((event) => {
        const info = event.payload as unknown as TerminalSession;
        const id =
          event.type === 'terminal:state'
            ? info.id
            : (event.payload as { sessionId?: string })?.sessionId;
        if (!id || owners.get(id) !== client) return;
        if (event.type === 'terminal:state') {
          const original = useTerminalStore.getState().sessions.find((s) => s.id === id);
          if (original)
            stateEvent({
              ...info,
              repositoryId: original.repositoryId,
              source: original.source,
              connectionId: original.connectionId,
              environment:
                original.source === 'ssh' || window.aluneAgent
                  ? original.environment
                  : info.environment || original.environment,
            });
        } else if (event.type === 'terminal:output')
          outputEvent(event.payload as unknown as TerminalOutput);
        else if (event.type === 'terminal:removed') removeLocal(id);
      });
      const close = client.onClose(() => {
        if (client === uiAgent) useTerminalStore.setState({ connected: false });
        for (const [id, owner] of owners)
          if (owner === client) {
            owners.delete(id);
            const session = useTerminalStore.getState().sessions.find((s) => s.id === id);
            if (session && terminalNeedsConfirmation(session))
              patch(id, { state: 'disconnected', error: '连接已断开，请显式新建会话。' });
            const runtime = runtimes.get(id);
            if (runtime) runtime.terminal.options.disableStdin = true;
          }
        off();
        disposers.delete(dispose);
      });
      const dispose = () => {
        off();
        close();
      };
      disposers.add(dispose);
    });
    useTerminalStore.setState({ connected: uiAgent.state === 'ready', error: '' });
    workspaceEnd = () => {
      detach();
      for (const dispose of disposers) dispose();
    };
  } else if (!uiAgent) {
    useTerminalStore.setState({ connected: false, error: 'Agent 尚未连接，终端不可用。' });
  }
  return () => {
    references--;
    // React StrictMode immediately reattaches effects; do not kill its shells.
    queueMicrotask(() => {
      if (!references) {
        workspaceEnd?.();
        workspaceEnd = undefined;
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
  // xterm 6 only reveals its scrollbar while scrolling; keep it visible once
  // there is history to scroll, but not as a full-height slider without any.
  const syncScrollable = () => {
    const scrollable = String(terminal.buffer.active.baseY > 0);
    if (element.dataset.scrollable !== scrollable) element.dataset.scrollable = scrollable;
  };
  terminal.onWriteParsed(syncScrollable);
  terminal.onResize(syncScrollable);
  terminal.buffer.onBufferChange(syncScrollable);
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
    if (!handleTerminalNavigationKey(event, () => document
      .querySelector<HTMLButtonElement>('[data-terminal-new]:not(:disabled), .terminal-heading button[aria-label="全部终端会话"]')
      ?.focus())) return false;
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
    environment: repo.source === 'local' ? (window.aluneAgent ? '本机' : 'Alune 服务主机') : 'SSH',
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
    if (connected(id))
      void request('terminal:close', { sessionId: id, confirmed: true }).catch(() => {});
  }
}
function removeLocal(id: string) {
  owners.delete(id);
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
  const runtime = runtimes.get(session.id);
  if (runtime?.closing) return runtime.closing;
  const close = async () => {
    if (connected(session.id)) {
      try {
        await request('terminal:close', { sessionId: session.id, confirmed: true });
      } catch (error) {
        if (terminalNeedsConfirmation(session)) throw error;
        // Disconnect already destroyed this finished session on the server.
      }
    }
    removeLocal(session.id);
  };
  const done = close();
  if (runtime) runtime.closing = done;
  try {
    await done;
  } finally {
    if (runtime) runtime.closing = undefined;
  }
}
