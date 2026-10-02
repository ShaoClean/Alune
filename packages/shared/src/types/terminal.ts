export const TERMINAL_LIMITS = {
  sessions: 8,
  historyLines: 10_000,
  historyBytes: 2 * 1024 * 1024,
  packetBytes: 16 * 1024,
  inputBytes: 16 * 1024,
  pendingBytes: 256 * 1024,
  windowBytes: 64 * 1024,
} as const;

export type TerminalState = 'connecting' | 'running' | 'exited' | 'disconnected' | 'failed';

export interface TerminalSession {
  id: string;
  requestId: string;
  repositoryId: string;
  repositoryName: string;
  source: 'local' | 'ssh';
  connectionId?: string;
  environment: string;
  initialPath: string;
  state: TerminalState;
  createdAt: number;
  exitCode?: number;
  signal?: number | string;
  error?: string;
}

export interface TerminalOutput {
  sessionId: string;
  sequence: number;
  data: string;
}

export type TerminalReply<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export const terminalNeedsConfirmation = (session: Pick<TerminalSession, 'state'>) =>
  session.state === 'running' || session.state === 'connecting';
