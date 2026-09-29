const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  createWorkspacePreferences,
  isTrustedWorkspaceSender,
  saveWorkspacePreferences,
} = require('../src/workspace-preferences.cjs');

test('workspace preferences survive a new reader; invalid writes preserve the last complete file', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workspace-preferences-'));
  try {
    const file = path.join(directory, 'workspace.json');
    const preferences = createWorkspacePreferences(file);
    assert.equal(preferences.load(), null);
    const value = JSON.stringify({
      version: 1,
      state: {
        connectionOrder: ['b', 'a'],
        collapsedConnectionIds: ['b'],
        layout: { sidebarCollapsed: true, sidebarWidth: 310, changesWidth: 430 },
      },
    });
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('synchronous saves are readable before reply and reject untrusted senders without changing disk', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workspace-session-'));
  try {
    const file = path.join(directory, 'workspace.json');
    const preferences = createWorkspacePreferences(file);
    const origin = 'http://127.0.0.1:41000';
    const mainFrame = { url: origin + '/' };
    const contents = { mainFrame };
    const event = { sender: contents, senderFrame: mainFrame };
    const value = JSON.stringify({ version: 1, state: {
      repositorySession: { ids: ['ssh', 'local'], activeId: 'local' },
      appearance: { theme: 'dark', reduceMotion: true },
    } });
    assert.equal(saveWorkspacePreferences(event, contents, origin, preferences, value), null);
    assert.equal(createWorkspacePreferences(file).load(), value);
    for (const invalid of [{ ...event, sender: {} }, { ...event, senderFrame: { ...mainFrame } }])
      assert.match(saveWorkspacePreferences(invalid, contents, origin, preferences, '{}'), /denied/);
    assert.match(saveWorkspacePreferences(event, contents, origin, preferences, '{}'), /Invalid/);
    assert.equal(preferences.load(), value);
    assert.equal(saveWorkspacePreferences(event, contents, origin, {
      save() { throw new Error('disk full'); },
    }, value), 'disk full');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('workspace IPC accepts only the application window main frame at the current origin', () => {
  const mainFrame = { url: 'http://127.0.0.1:41000/repositories' };
  const contents = { mainFrame };
  const event = { sender: contents, senderFrame: mainFrame };
  assert.equal(isTrustedWorkspaceSender(event, contents, 'http://127.0.0.1:41000'), true);
  assert.equal(
    isTrustedWorkspaceSender({ ...event, sender: {} }, contents, 'http://127.0.0.1:41000'),
    false,
  );
  assert.equal(
    isTrustedWorkspaceSender(
      { ...event, senderFrame: { ...mainFrame } },
      contents,
      'http://127.0.0.1:41000',
    ),
    false,
  );
  assert.equal(isTrustedWorkspaceSender(event, contents, 'http://127.0.0.1:42000'), false);
  assert.equal(
    isTrustedWorkspaceSender({ sender: contents }, contents, 'http://127.0.0.1:41000'),
    false,
  );
});
