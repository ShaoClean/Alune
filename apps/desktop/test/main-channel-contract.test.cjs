const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

test('main process registers guarded workspace and log channels', () => {
  for (const channel of [
    'workspace:choose-directory',
    'workspace:${operation}',
    'workspace:save-sync',
    'logs:open-window',
    'logs:open-directory',
    'logs:choose-directory',
  ]) assert.match(source, new RegExp(channel.replace(/[${}:]/g, '\\$&')));
  assert.match(source, /isTrustedWorkspaceSender\(event, window\?\.webContents, origin\)/);
  assert.match(source, /const trustedLogSender = \(event\) =>/);
  assert.match(source, /event\.returnValue = saveWorkspacePreferences\(/);
});

test('main process pairs terminal shutdown request and trusted response', () => {
  assert.match(source, /ipcMain\.on\('terminal:shutdown-response', respond\)/);
  assert.match(source, /target\.webContents\.send\('terminal:shutdown-request', \{ requestId, sessions \}\)/);
  assert.match(source, /id !== requestId/);
  assert.match(source, /event\.sender !== target\.webContents/);
  assert.match(source, /consent === true/);
  assert.match(source, /registry\.remove\(/);
});
