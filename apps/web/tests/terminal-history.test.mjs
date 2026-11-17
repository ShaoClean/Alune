import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retainedTerminalLines } from '../src/stores/terminalHistory.ts';
import { useTerminalStore } from '../src/stores/terminalState.ts';

test('terminal history counts UTF-8 and retains newest lines within both bounds', () => {
  const lines = ['old', '中文', 'new'];
  assert.equal(
    retainedTerminalLines(lines.length, (index) => lines[index], 11),
    2,
  );
  assert.equal(
    retainedTerminalLines(10001, () => ''),
    10000,
  );
  assert.equal(
    retainedTerminalLines(1, () => 'e' + '\u0301'.repeat(100), 20),
    0,
  );
});

test('terminal selection is remembered independently for repositories and hiding preserves sessions', () => {
  const a = { id: 'a', repositoryId: 'repo-a' };
  const b = { id: 'b', repositoryId: 'repo-b' };
  useTerminalStore.setState({ sessions: [a, b], selected: {}, visible: false });
  useTerminalStore.getState().select(a);
  useTerminalStore.getState().select(b);
  useTerminalStore.getState().toggle();
  assert.deepEqual(useTerminalStore.getState().selected, { 'repo-a': 'a', 'repo-b': 'b' });
  assert.equal(useTerminalStore.getState().sessions.length, 2);
  assert.equal(useTerminalStore.getState().visible, false);
});

// xterm's parser/buffer runs under Node without opening a renderer or window.
// Replay ConPTY's resize redraw to prove that previous screen output survives.
test('Windows execution-host resize redraw preserves terminal history on any UI host', async () => {
  const { createRequire } = await import('node:module');
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm');
  const { applyTerminalHostOptions } = await import('../src/stores/terminalOptions.ts');
  for (const windows of [false, true]) {
    const terminal = new Terminal({ cols: 80, rows: 24 });
    try {
      applyTerminalHostOptions(terminal, windows
        ? { windowsPty: { backend: 'conpty', buildNumber: 26100 } } : {});
      await new Promise(resolve => terminal.write('retained-before-resize\r\n' + 'line\r\n'.repeat(20), resolve));
      terminal.resize(80, 5);
      terminal.resize(80, 24);
      if (windows) await new Promise(resolve => terminal.write('\x1b[H\x1b[2Jredrawn prompt', resolve));
      const lines = Array.from({ length: terminal.buffer.active.length }, (_, i) =>
        terminal.buffer.active.getLine(i).translateToString(true)).join('\n');
      assert.match(lines, /retained-before-resize/);
      applyTerminalHostOptions(terminal, {});
      assert.deepEqual(terminal.options.windowsPty, {});
    } finally { terminal.dispose(); }
  }
});

test('a PTY becoming ready receives dimensions already fitted before it connected', async () => {
  const { createRequire } = await import('node:module');
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm');
  const { synchronizeTerminalSize } = await import('../src/stores/terminalOptions.ts');
  const terminal = new Terminal({ cols: 80, rows: 24 });
  try {
    terminal.resize(52, 18); // Renderer layout completed during PTY startup.
    const resizeEvents = [], hostSizes = [];
    terminal.onResize(size => resizeEvents.push(size));
    synchronizeTerminalSize(terminal, () => terminal.resize(52, 18),
      (cols, rows) => hostSizes.push({ cols, rows }));
    assert.deepEqual(resizeEvents, []); // xterm deliberately suppresses this event.
    assert.deepEqual(hostSizes, [{ cols: 52, rows: 18 }]);
    terminal.onResize(({ cols, rows }) => hostSizes.push({ cols, rows }));
    synchronizeTerminalSize(terminal, () => terminal.resize(60, 20),
      (cols, rows) => hostSizes.push({ cols, rows }));
    assert.deepEqual(hostSizes, [{ cols: 52, rows: 18 }, { cols: 60, rows: 20 }]);
  } finally { terminal.dispose(); }
});
