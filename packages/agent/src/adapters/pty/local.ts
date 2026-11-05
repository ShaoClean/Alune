import * as pty from 'node-pty';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TerminalTransport, TerminalCallbacks } from '../../ports/terminal';
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
  await access(shell, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
  signal.throwIfAborted();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
  // Do not pass desktop/test controls to child shells.
  for (const key of Object.keys(env))
    if (key.startsWith('ALUNE_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
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
      if (exited) {
        // node-pty's Windows output worker owns a pipe server even after the
        // shell exits. kill() also disposes that worker and native handles.
        if (process.platform === 'win32') child.kill();
        return stopped;
      }
      // A backpressured PTY must drain its descriptor while shutting down.
      // Otherwise macOS can keep a killed process waiting on the full PTY.
      child.resume();
      // Foreground jobs may have their own process group. Snapshot descendants
      // before killing the session leader, while their parent identity is known.
      if (process.platform !== 'win32') {
        try {
          const rows = execFileSync('/bin/ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
            encoding: 'utf8',
            timeout: 1000,
            maxBuffer: 2 * 1024 * 1024,
          })
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
