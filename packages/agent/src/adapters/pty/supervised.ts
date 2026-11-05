import { fork } from 'node:child_process';
import type { TerminalTransport, TerminalCallbacks } from '../../ports/terminal';

export function supervisedTerminal(
  cwd: string,
  cols: number,
  rows: number,
  signal: AbortSignal,
  callbacks: TerminalCallbacks,
): Promise<TerminalTransport> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = fork(require.resolve('./worker'), [], {
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
      execArgv: [],
      env: process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
    });
    const stream = child.stdout!;
    let ready = false,
      disposing = false;
    let result: { code?: number; signal?: string | number } | undefined;
    let failure: string | undefined;
    // Explicit IPC disconnect can suppress ChildProcess 'close' even after exit.
    // Wait for both OS process termination and the final output descriptor instead.
    const exited = new Promise<void>((done) => {
      child.once('exit', (code, signal) => {
        failure ??= `终端进程已断开（worker ${signal ?? code}），请显式新建。`;
        done();
      });
      child.once('error', () => {
        if (!child.pid) done();
      });
    });
    const drained = new Promise<void>((done) => stream.once('close', () => done()));
    const stopped = Promise.all([exited, drained]).then(() => {});

    const dispose = () => {
      disposing = true;
      stream.resume();
      if (child.connected) child.disconnect();
      return stopped;
    };
    const abort = () => {
      void dispose();
    };
    signal.addEventListener('abort', abort, { once: true });
    void stopped.then(() => {
      signal.removeEventListener('abort', abort);
      if (!ready) reject(new Error(failure ?? '终端启动已中断。'));
      else if (!disposing) {
        if (result) callbacks.exit(result.code, result.signal);
        else callbacks.disconnect(failure ?? '终端进程已断开，请显式新建。');
      }
    });
    child.on('error', (error) => {
      failure = error.message;
    });
    const send = (message: object) => {
      if (!child.connected || disposing) throw new Error('终端进程已断开。');
      child.send(message, (error) => {
        if (error && !disposing) {
          failure = error.message;
          if (child.connected) child.disconnect();
        }
      });
    };
    stream.setEncoding('utf8');
    stream.on('data', (data: string) => {
      if (!disposing) callbacks.data(data);
    });
    child.on('message', (m: any) => {
      if (disposing) return;
      if (m.type === 'exit') result = m;
      else if (m.type === 'error') failure = m.message;
      else if (m.type === 'ready') {
        ready = true;
        resolve({
          write: (data) => send({ type: 'input', data }),
          resize: (cols, rows) => send({ type: 'resize', cols, rows }),
          pause: () => {
            stream.pause();
          },
          resume: () => {
            stream.resume();
          },
          dispose,
        });
      }
    });
    send({ type: 'open', cwd, cols, rows });
  });
}
