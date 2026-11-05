import { StringDecoder } from 'node:string_decoder';
import type { SSHConnection } from '@alune/ssh-client';
import type { ClientChannel } from 'ssh2';
import type {
  TerminalCallbacks,
  TerminalTransport,
} from '@alune/agent/terminals';
export type {
  TerminalCallbacks,
  TerminalTransport,
} from '@alune/agent/terminals';
export { localTerminal } from '@alune/agent/local-pty';

export async function sshTerminal(
  connection: SSHConnection,
  cwd: string,
  cols: number,
  rows: number,
  signal: AbortSignal,
  callbacks: TerminalCallbacks,
): Promise<TerminalTransport> {
  const channel: ClientChannel = await connection.openTerminal(
    cwd,
    cols,
    rows,
    signal,
  );
  const decoder = new StringDecoder('utf8');
  let disposed = false;
  let code: number | undefined;
  let exitSignal: string | undefined;
  const data = (chunk: Buffer) => callbacks.data(decoder.write(chunk));
  const disconnected = () => {
    if (!disposed)
      callbacks.disconnect(
        'SSH 连接已断开；远端进程状态未知。请显式新建会话。',
      );
  };
  const closed = () => {
    if (disposed) return;
    const tail = decoder.end();
    if (tail) callbacks.data(tail);
    if (code === undefined && !exitSignal) disconnected();
    else callbacks.exit(code, exitSignal);
  };
  const error = (error: Error) => callbacks.disconnect(error.message);
  channel.on('data', data);
  channel.stderr.on('data', data);
  channel.on('exit', (value: number | null, valueSignal?: string) => {
    code = value ?? undefined;
    exitSignal = valueSignal;
  });
  channel.once('close', closed);
  channel.on('error', error);
  connection.on('disconnect', disconnected);
  return {
    write: (data) => {
      // ssh2 buffers writes internally; reject instead of accumulating unbounded input.
      if (channel.writableLength > 64 * 1024)
        throw new Error('终端输入过快，请稍后重试。');
      channel.write(data);
    },
    resize: (cols, rows) => channel.setWindow(rows, cols, 0, 0),
    pause: () => {
      channel.pause();
      channel.stderr.pause();
    },
    resume: () => {
      channel.resume();
      channel.stderr.resume();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      connection.off('disconnect', disconnected);
      channel.off('data', data);
      channel.stderr.off('data', data);
      channel.off('error', error);
      channel.off('close', closed);
      channel.on('error', () => {});
      channel.resume();
      channel.stderr.resume();
      channel.close();
    },
  };
}
