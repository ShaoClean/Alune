const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gitFileCommand } = require('../dist/git-shell');
const { NewFileDeletion } = require('../dist/new-file-deletion');

test('Windows SSH receives encoded literal arguments and relays raw Git output', () => {
  const command = gitFileCommand('C:\\仓库 %TEMP%\\', [
    'ls-files',
    '-z',
    '--',
    "子目录/it's $name & [*].txt",
  ]);
  const prefix = 'powershell -NoProfile -NonInteractive -EncodedCommand ';
  assert.ok(command.startsWith(prefix));
  const encoded = command.slice(prefix.length);
  assert.match(encoded, /^[a-zA-Z0-9+/=]+$/);
  const script = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.ok(script.includes('"C:\\仓库 %TEMP%\\\\"'));
  assert.ok(script.includes('"子目录/it\'\'s $name & [*].txt"'));
  assert.ok(script.includes('UseShellExecute = $false'));
  assert.ok(script.includes('StandardOutput.BaseStream.CopyToAsync'));
  assert.ok(script.includes("$ProgressPreference = 'SilentlyContinue'"));
  assert.ok(script.includes('$null = $stdoutCopy.GetAwaiter().GetResult()'));
  assert.ok(script.includes('$null = $stderrCopy.GetAwaiter().GetResult()'));
});

test('Windows file paths cannot use backslash traversal or NTFS alternate data streams', async () => {
  const deletion = new NewFileDeletion({
    execCommand() {
      throw new Error('must not connect');
    },
  });
  for (const name of ['..\\outside.txt', 'dir\\..\\outside.txt', 'new.txt:stream']) {
    await assert.rejects(deletion.preview('C:\\repo', name), /Windows 仓库/);
  }
});
