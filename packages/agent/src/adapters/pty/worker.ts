// A separate owner survives abrupt Agent death long enough to reap the PTY tree.
// Data uses a bounded OS pipe; control and parent death use a separate IPC channel.
import { localTerminal } from './local';
import type { TerminalTransport } from '../../ports/terminal';
const controller = new AbortController();
let terminal: TerminalTransport | undefined;
let starting: Promise<void> | undefined;
let ending = false;
function send(value: object) {
  if (process.connected)
    process.send!(value, (error) => {
      if (error) void stop();
    });
}
async function stop() {
  if (ending) return;
  ending = true;
  controller.abort();
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
        send({ type: 'exit', code, signal });
        void stop();
      },
      disconnect(message) {
        send({ type: 'error', message });
        void stop();
      },
    })
      .then((value) => {
        terminal = value;
        if (process.stdout.writableNeedDrain) terminal.pause();
        if (!ending) send({ type: 'ready' });
      })
      .catch(() => {
        send({ type: 'error', message: '无法启动仓库终端，请检查目录与 shell。' });
        void stop();
      });
  } else if (m.type === 'input') terminal?.write(m.data);
  else if (m.type === 'resize') terminal?.resize(m.cols, m.rows);
});
