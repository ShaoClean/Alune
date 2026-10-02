import * as pty from 'node-pty';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { execFileSync } from 'node:child_process';
import type { SSHConnection } from '@alune/ssh-client';
import type { ClientChannel } from 'ssh2';

export interface TerminalTransport {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  dispose(): void | Promise<void>;
}
export interface TerminalCallbacks {
  data(data: string): void;
  exit(code?: number, signal?: number | string): void;
  disconnect(message: string): void;
}

export async function localTerminal(
  cwd: string,
  cols: number,
  rows: number,
  signal: AbortSignal,
  callbacks: TerminalCallbacks,
): Promise<TerminalTransport> {
  if (!path.isAbsolute(cwd) || !(await stat(cwd)).isDirectory())
    throw new Error('启动目录不存在或不是目录。');
  await access(cwd, constants.R_OK | constants.X_OK);
  const shell =
    process.platform === 'win32'
      ? process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
      : process.env.SHELL || os.userInfo().shell || '/bin/sh';
  await access(
    shell,
    process.platform === 'win32' ? constants.F_OK : constants.X_OK,
  );
  signal.throwIfAborted();
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
  // Do not pass desktop/test controls to child shells.
  for (const key of Object.keys(env))
    if (key.startsWith('ALUNE_')) delete env[key];
  const child = pty.spawn(shell, process.platform === 'win32' ? [] : ['-i'], {
    name: 'xterm-256color',
    cwd,
    cols,
    rows,
    env,
  });
  let exited = false;
  let disposed = false;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const data = child.onData(callbacks.data);
  const exit = child.onExit(({ exitCode, signal: code }) => {
    exited = true;
    exit.dispose();
    resolveStopped();
    if (!disposed) callbacks.exit(exitCode, code);
  });
  return {
    write: (data) => child.write(data),
    resize: (cols, rows) => child.resize(cols, rows),
    pause: () => child.pause(),
    resume: () => child.resume(),
    dispose: () => {
      if (disposed) return stopped;
      disposed = true;
      data.dispose();
      if (exited) return stopped;
      // A backpressured PTY must drain its descriptor while shutting down.
      // Otherwise macOS can keep a killed process waiting on the full PTY.
      child.resume();
      // Foreground jobs may have their own process group. Snapshot descendants
      // before killing the session leader, while their parent identity is known.
      if (process.platform !== 'win32') {
        try {
          const rows = execFileSync(
            '/bin/ps',
            ['-A', '-o', 'pid=', '-o', 'ppid='],
            {
              encoding: 'utf8',
              timeout: 1000,
              maxBuffer: 2 * 1024 * 1024,
            },
          )
            .trim()
            .split('\n')
            .map((line) => line.trim().split(/\s+/).map(Number));
          const descendants = new Set([child.pid]);
          for (let changed = true; changed; ) {
            changed = false;
            for (const [pid, parent] of rows)
              if (descendants.has(parent) && !descendants.has(pid)) {
                descendants.add(pid);
                changed = true;
              }
          }
          for (const pid of [...descendants].reverse()) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              /* exited during teardown */
            }
          }
        } catch {
          child.kill('SIGKILL');
        }
      } else child.kill(); // ConPTY closes its console process tree.
      return stopped;
    },
  };
}

export async function sshTerminal(
  connection: SSHConnection,
  cwd: string,
  cols: number,
  rows: number,
  signal: AbortSignal,
  callbacks: TerminalCallbacks,
): Promise<TerminalTransport> {
  const check = await connection.execCommand(
    'test -x "${SHELL:-/bin/sh}"',
    cwd,
    signal,
  );
  if (check.exitCode !== 0)
    throw new Error(check.stderr || '无法访问启动目录或执行登录 shell。');
  signal.throwIfAborted();
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
