const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canWriteClipboard } = require('../src/clipboard-permissions.cjs');
const app = {},
  other = {},
  origin = 'http://127.0.0.1:3456';
test('only the trusted app renderer can write clipboard text', () => {
  assert.equal(
    canWriteClipboard(app, 'clipboard-sanitized-write', origin + '/repositories/a', app, origin),
    true,
  );
  assert.equal(canWriteClipboard(other, 'clipboard-sanitized-write', origin, app, origin), false);
  assert.equal(canWriteClipboard(null, 'clipboard-sanitized-write', origin, null, origin), false);
  assert.equal(
    canWriteClipboard(app, 'clipboard-sanitized-write', 'https://example.com', app, origin),
    false,
  );
  assert.equal(canWriteClipboard(app, 'clipboard-sanitized-write', 'invalid', app, origin), false);
});
test('clipboard reading and unrelated permissions remain denied', () => {
  for (const permission of ['clipboard-read', 'clipboard-read-write', 'media', 'notifications'])
    assert.equal(canWriteClipboard(app, permission, origin, app, origin), false);
});
