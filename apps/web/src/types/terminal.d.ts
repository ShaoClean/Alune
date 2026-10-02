import type { TerminalSession } from '@alune/shared';
declare global {
  interface Window {
    aluneTerminal?: {
      onShutdownRequested(
        callback: (request: { requestId: string; sessions: TerminalSession[] }) => void,
      ): () => void;
      respondToShutdown(requestId: string, confirmed: boolean): void;
    };
  }
}
