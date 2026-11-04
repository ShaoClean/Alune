import { StdioTransport } from '@alune/agent-client/node';
import { AgentSession } from '../server/session';
import type { SessionOptions } from '../server/session';

export async function serveStdio(options: SessionOptions): Promise<void> {
  const transport = new StdioTransport(process.stdin, process.stdout);
  const session = new AgentSession(transport, options);
  const stop = () => {
    void session.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await session.closed;
    if (session.shutdownTimedOut)
      throw new Error('Agent shutdown exceeded deadline; task outcomes are unknown');
    if (session.shutdownFailed) throw new Error('Agent resource disposal failed');
    if (
      session.failure &&
      (!('kind' in session.failure) || session.failure.kind !== 'disconnected')
    )
      throw new Error('Agent protocol session failed');
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
