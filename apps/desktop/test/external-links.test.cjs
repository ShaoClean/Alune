const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createExternalLinkHandler } = require('../src/external-links.cjs');

test('web links open in the system browser without creating an Electron window', () => {
  const opened = [];
  const handler = createExternalLinkHandler(async (url) => {
    opened.push(url);
  });
  for (const url of [
    'https://github.com/ShaoClean/remote-git/releases',
    'http://example.com/notes',
  ]) {
    assert.deepEqual(handler({ url }), { action: 'deny' });
  }
  assert.deepEqual(opened, [
    'https://github.com/ShaoClean/remote-git/releases',
    'http://example.com/notes',
  ]);
});

test('scripts, files, custom protocols and relative URLs never reach the OS', () => {
  const handler = createExternalLinkHandler(async () => assert.fail('unsafe URL opened'));
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '\tjavascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///tmp/installer',
    'mailto:user@example.com',
    'ms-settings:privacy',
    'vscode://file/tmp/test',
    '//example.com/notes',
    '/relative',
    '#heading',
    '',
    'not a URL',
  ]) {
    assert.deepEqual(handler({ url }), { action: 'deny' }, url);
  }
});

test('a browser launch failure is handled without allowing an Electron popup', async (t) => {
  const warning = t.mock.method(console, 'warn', () => {});
  const handler = createExternalLinkHandler(async () => {
    throw new Error('no browser');
  });
  assert.deepEqual(handler({ url: 'https://example.com/' }), { action: 'deny' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warning.mock.callCount(), 1);
});
