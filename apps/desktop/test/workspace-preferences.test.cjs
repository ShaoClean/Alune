const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createWorkspacePreferences,
  isTrustedWorkspaceSender,
  saveWorkspacePreferences,
  workspaceBackground,
} = require('../src/workspace-preferences.cjs');

const valid = JSON.stringify({ version: 1, state: { appearance: { theme: 'dark' } } });
const sender = { url: 'http://localhost:5173/settings' };
const contents = { mainFrame: sender };
const event = { sender: contents, senderFrame: sender };

function tempFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-workspace-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'workspace.json');
}

test('trusted workspace sender requires the exact main frame and origin', () => {
  assert.equal(isTrustedWorkspaceSender(event, contents, 'http://localhost:5173'), true);
  assert.equal(isTrustedWorkspaceSender({ ...event, senderFrame: { url: 'http://localhost:5174' } }, contents, 'http://localhost:5173'), false);
  assert.equal(isTrustedWorkspaceSender({ ...event, senderFrame: { url: 'http://localhost:5173', other: true } }, contents, 'http://localhost:5173'), false);
  assert.equal(isTrustedWorkspaceSender({ ...event, sender: {} }, contents, 'http://localhost:5173'), false);
  assert.equal(isTrustedWorkspaceSender({ sender: contents, senderFrame: { url: 'not a url' } }, contents, 'http://localhost:5173'), false);
});

test('workspace preferences save atomically, loads valid data and clears the file', (t) => {
  const file = tempFile(t);
  const preferences = createWorkspacePreferences(file);
  assert.equal(preferences.load(), null);
  preferences.save(valid);
  assert.equal(preferences.load(), valid);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(file + '.tmp'), false);
  preferences.clear();
  assert.equal(preferences.load(), null);
});

test('workspace preference validation rejects malformed JSON and wrong versions without residue', (t) => {
  const file = tempFile(t);
  const preferences = createWorkspacePreferences(file);
  for (const value of ['{broken', '{}', JSON.stringify({ version: 2, state: {} }), JSON.stringify({ version: 1, state: [] }), null]) {
    assert.throws(() => preferences.save(value), { message: 'Invalid workspace preferences' });
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(file + '.tmp'), false);
  }
});

test('synchronous workspace IPC save always returns a safe error string', (t) => {
  const file = tempFile(t);
  const preferences = createWorkspacePreferences(file);
  assert.equal(saveWorkspacePreferences(event, contents, 'http://localhost:5173', preferences, valid), null);
  assert.equal(saveWorkspacePreferences({ ...event, senderFrame: { url: 'http://evil.invalid' } }, contents, 'http://localhost:5173', preferences, valid), 'Workspace access denied');
  assert.equal(saveWorkspacePreferences(event, contents, 'http://localhost:5173', preferences, '{broken'), 'Invalid workspace preferences');
  assert.equal(preferences.load(), valid);
});

test('workspace background uses explicit theme before system fallback', () => {
  assert.equal(workspaceBackground(valid, false), '#151e30');
  assert.equal(workspaceBackground(JSON.stringify({ version: 1, state: { appearance: { theme: 'light' } } }), true), '#f5f7fb');
  assert.equal(workspaceBackground('{broken', true), '#151e30');
  assert.equal(workspaceBackground('{}', false), '#f5f7fb');
});
