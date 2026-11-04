const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateLogSnapshot, validateLogChunk, validateLogEntries, validateLogSettingsResult } = require('../dist');
test('diagnostics schema bounds immutable chunks and validates public settings and log records', () => {
  const snapshot = { snapshotId: 'snapshot', bytes: 65536, chunks: 2, entries: 1 };
  assert.equal(validateLogSnapshot(snapshot), snapshot);
  for (const change of [{ chunks: 1 }, { bytes: 17 * 1024 * 1024 }, { entries: -1 }]) assert.throws(() => validateLogSnapshot({ ...snapshot, ...change }));
  assert.equal(validateLogChunk({ snapshotId: 'snapshot', index: 0, base64: 'W10=' }).index, 0);
  assert.throws(() => validateLogChunk({ snapshotId: 'snapshot', index: 0, base64: 'a'.repeat(50000) }));
  assert.throws(() => validateLogChunk({ snapshotId: 'snapshot', index: 0, base64: 'invalid\n' }));
  const entry = { time: '2026-01-01T00:00:00.000Z', level: 'INFO', source: 'fixture', message: 'safe' };
  assert.deepEqual(validateLogEntries([entry]), [entry]);
  assert.throws(() => validateLogEntries([{ ...entry, secret: 'unexpected' }]));
  assert.throws(() => validateLogEntries([{ ...entry, context: [] }]));
  const result = { revision: 'revision', settings: { directory: '/fixture/logs', defaultDirectory: '/fixture/logs', customDirectory: null, level: 'INFO', retentionDays: 14, maxTotalMB: 200 } };
  assert.equal(validateLogSettingsResult(result), result);
  assert.throws(() => validateLogSettingsResult({ ...result, settings: { ...result.settings, retentionDays: 366 } }));
});
