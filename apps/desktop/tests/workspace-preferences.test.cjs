const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createWorkspacePreferences, isTrustedWorkspaceSender } = require('../src/workspace-preferences.cjs');

test('workspace preferences survive a new reader; invalid writes preserve the last complete file', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workspace-preferences-'));
  try {
    const file = path.join(directory, 'workspace.json');
    const preferences = createWorkspacePreferences(file);
    assert.equal(preferences.load(), null);
    const value = JSON.stringify({ version: 1, state: { connectionOrder: ['b', 'a'], collapsedConnectionIds: ['b'] } });
    preferences.save(value);
    assert.equal(createWorkspacePreferences(file).load(), value);
    assert.equal(existsSync(`${file}.tmp`), false);
    assert.throws(() => preferences.save('{broken'));
    assert.throws(() => preferences.save(JSON.stringify({ path: '/unrelated' })));
    assert.equal(readFileSync(file, 'utf8'), value);
    writeFileSync(file, '{broken');
    assert.equal(preferences.load(), null);
    preferences.clear();
    assert.equal(preferences.load(), null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('workspace IPC accepts only the application window main frame at the current origin', () => {
  const mainFrame = { url: 'http://127.0.0.1:41000/repositories' };
  const contents = { mainFrame };
  const event = { sender: contents, senderFrame: mainFrame };
  assert.equal(isTrustedWorkspaceSender(event, contents, 'http://127.0.0.1:41000'), true);
  assert.equal(isTrustedWorkspaceSender({ ...event, sender: {} }, contents, 'http://127.0.0.1:41000'), false);
  assert.equal(isTrustedWorkspaceSender({ ...event, senderFrame: { ...mainFrame } }, contents, 'http://127.0.0.1:41000'), false);
  assert.equal(isTrustedWorkspaceSender(event, contents, 'http://127.0.0.1:42000'), false);
  assert.equal(isTrustedWorkspaceSender({ sender: contents }, contents, 'http://127.0.0.1:41000'), false);
});
