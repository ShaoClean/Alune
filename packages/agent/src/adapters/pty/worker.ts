// A separate owner survives abrupt Agent death long enough to reap the PTY tree.
// Data uses a bounded OS pipe; control and parent death use a separate IPC channel.
import { localTerminal } from './local';
import type { TerminalTransport } from '../../ports/terminal';
const controller = new AbortController();
let terminal: TerminalTransport | undefined;
let starting: Promise<void> | undefined;
let ending = false;
function send(value: object): Promise<void> {
  return new Promise((resolve) => {
    if (!process.connected) return resolve();
    process.send!(value, (error) => {
      resolve();
      if (error) void stop();
    });
  });
}
async function stop(final?: object) {
  if (ending) return;
  ending = true;
  controller.abort();
  // Hand the native exit status to IPC before tearing down ConPTY. Its helper
  // may close handles synchronously; a queued send alone is not a receipt.
  if (final) await send(final);
  await starting;
  await terminal?.dispose();
  if (process.connected) process.disconnect();
}
process.once('disconnect', () => void stop());
process.once('SIGTERM', () => void stop());
process.stdout.on('error', () => void stop());
process.stdout.on('drain', () => {
  if (!ending) terminal?.resume();
});
process.on('message', (m: any) => {
  if (ending) return;
  if (m.type === 'open' && !starting) {
    starting = localTerminal(m.cwd, m.cols, m.rows, controller.signal, {
      data(data) {
        if (!ending && !process.stdout.write(data)) terminal?.pause();
      },
      exit(code, signal) {
        void stop({ type: 'exit', code, signal });
      },
      disconnect(message) {
        void stop({ type: 'error', message });
      },
    })
      .then((value) => {
        terminal = value;
        if (process.stdout.writableNeedDrain) terminal.pause();
        if (!ending) void send({ type: 'ready' });
      })
      .catch(() => {
        void stop({ type: 'error', message: '无法启动仓库终端，请检查目录与 shell。' });
      });
  } else {
    try {
      if (m.type === 'input') terminal?.write(m.data);
      else if (m.type === 'resize') terminal?.resize(m.cols, m.rows);
    } catch (error) {
      // ConPTY rejects resize as soon as cmd exits, before its final output
      // has drained and before node-pty delivers onExit. Keep that exit event.
      if (
        process.platform === 'win32' &&
        m.type === 'resize' &&
        error instanceof Error &&
        error.message === 'Cannot resize a pty that has already exited'
      )
        return;
      void stop({ type: 'error', message: '终端控制通道已关闭，请显式新建。' });
    }
  }
});
