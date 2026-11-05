import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { AgentClient } from './client';
import { StdioTransport } from './stdio';
import { ProtocolError } from '@alune/protocol';

export interface AgentProcess {
  client: AgentClient;
  process: ChildProcessWithoutNullStreams;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  close(): Promise<void>;
}
export function spawnAgent(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStderr?: (text: string) => void;
    shutdownMs?: number;
  } = {},
): AgentProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
  const transport = new StdioTransport(child.stdout, child.stdin);
  const client = new AgentClient(transport);
  let ended = false;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => {
      ended = true;
      resolve({ code, signal });
    });
  });
  child.once('error', (error) => client.close(error));
  child.stderr.on('data', (chunk: Buffer) => {
    try {
      options.onStderr?.(chunk.toString('utf8'));
    } catch (error) {
      client.close(error as Error);
    }
  });
  let closing: Promise<void> | undefined;
  return {
    client,
    process: child,
    exited,
    close() {
      if (closing) return closing;
      closing = (async () => {
        transport.finishChild(
          new ProtocolError('disconnected', 'Agent process closing', 'unknown'),
        );
        if (ended) return;
        let force: ReturnType<typeof setTimeout> | undefined;
        const terminate = setTimeout(
          () => {
            child.kill('SIGTERM');
            force = setTimeout(() => child.kill('SIGKILL'), 1000);
          },
          options.shutdownMs ?? (process.platform === 'win32' ? 14000 : 4000),
        );
        try {
          await exited;
        } finally {
          clearTimeout(terminate);
          clearTimeout(force);
        }
      })();
      return closing;
    },
  };
}
