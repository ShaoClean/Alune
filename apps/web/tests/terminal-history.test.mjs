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
