import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LogHistoryCursor } from '../src/pages/log-history.ts';
const row = (message, context) => ({ time: '2026-11-08T00:00:00.000Z', level: 'INFO', source: 'test', message, ...(context ? { context } : {}) });

test('same Agent reconnect retains history without appending the overlapping window twice', () => {
  const cursor = new LogHistoryCursor();
  const a = row('a'), b = row('b'), c = row('c');
  assert.deepEqual(cursor.take('agent-a', [a, b]), [a, b]);
  assert.deepEqual(cursor.take('agent-a', [a, b]), []);
  assert.deepEqual(cursor.take('agent-a', [b, c]), [c]);
  assert.deepEqual(cursor.take('agent-a', [b, c]), []);
});

test('ordered overlap preserves repeated identical rows and distinct level/context', () => {
  const cursor = new LogHistoryCursor(), a = row('repeat');
  assert.deepEqual(cursor.take('agent-a', [a]), [a]);
  assert.deepEqual(cursor.take('agent-a', [a, a]), [a]);
  const detail = row('repeat', { attempt: 2 });
  assert.deepEqual(cursor.take('agent-a', [a, a, detail]), [detail]);
  const warning = { ...detail, level: 'WARN' };
  assert.deepEqual(cursor.take('agent-a', [detail, warning]), [warning]);
});

test('another Agent never inherits the first Agent history cursor', () => {
  const cursor = new LogHistoryCursor(), a = row('same');
  cursor.take('agent-a', [a]);
  assert.deepEqual(cursor.take('agent-b', [a]), [a]);
  assert.deepEqual(cursor.take('agent-b', []), []);
  assert.deepEqual(cursor.take('agent-b', [a]), [a]);
});

test('log viewer owns the cursor outside its connection effect', () => {
  const source = readFileSync(new URL('../src/pages/LogViewerPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const history = useRef\(new LogHistoryCursor\(\)\)/);
  assert.match(source, /history\.current\.take\(uiAgent\.initialized!\.agentId, next\)/);
  assert.doesNotMatch(source, /previous: LogEntry\[\] = \[\]/);
});
