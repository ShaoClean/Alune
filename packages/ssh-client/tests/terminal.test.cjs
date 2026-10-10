const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SSHConnection } = require('../dist/connection-manager');
const { terminalShellCommands } = require('../dist/terminal-shell');

function fixture() {
  const connection = new SSHConnection({ host: 'fixture', username: 'test' });
  const channel = new EventEmitter();
  channel.pause = () => {};
  channel.stderr = { pause() {} };
  const calls = [];
  connection._connected = true;
  connection.client = {
    exec(command, options, callback) {
      calls.push({ command, options });
      callback(null, channel);
    },
  };
  return { connection, channel, calls };
}

for (const cwd of [
  'D:\\workspace\\mt_business_daemon',
  "D:/工作区/[repo] ' ; $variable & %TEMP%",
  '/D:/workspace/repo',
  '\\\\server\\share\\repo',
  '//server/share/repo',
]) {
  test(`Windows SSH checks and opens a PTY without POSIX commands: ${cwd}`, async () => {
    const { connection, channel, calls } = fixture();
    const controller = new AbortController();
    let checked = false;
    connection.execCommand = async (command, directory, signal) => {
      checked = true;
      assert.equal(directory, undefined, 'must not prepend the POSIX cd wrapper');
      assert.equal(signal, controller.signal);
      assert.match(command, /^powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand /);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    assert.equal(await connection.openTerminal(cwd, 100, 35, controller.signal), channel);
    assert.ok(checked);
    assert.equal(calls.length, 1);
    assert.match(calls[0].command, /^powershell -NoLogo -NoProfile -NoExit -EncodedCommand /);
    const script = Buffer.from(calls[0].command.split(' ').at(-1), 'base64').toString('utf16le');
    const directory = cwd.replace(/^\/([a-z]:[\\/])/i, '$1').replace(/\//g, '\\');
    assert.ok(script.includes(`Set-Location -LiteralPath '${directory.replace(/'/g, "''")}'`));
    assert.ok(script.includes('exit 125'), 'a failed cd must terminate even with -NoExit');
    assert.deepEqual(calls[0].options.pty, {
      term: 'xterm-256color',
      cols: 100,
      rows: 35,
      width: 0,
      height: 0,
    });
    assert.equal(connection.activeTasks, 1);
    channel.emit('close');
    assert.equal(connection.activeTasks, 0);
  });
}

test('invalid paths and failed or cancelled checks never start a PTY', async () => {
  for (const cwd of ['', 'relative/repo', 'C:relative', 'C:\\bad\0path']) {
    const { connection, calls } = fixture();
    connection.execCommand = async () => assert.fail('must validate before executing');
    await assert.rejects(
      connection.openTerminal(cwd, 80, 24, new AbortController().signal),
      /绝对/,
    );
    assert.equal(calls.length, 0);
  }
  for (const cwd of ['D:\\missing', '/missing']) {
    const { connection, calls } = fixture();
    connection.execCommand = async () => ({ exitCode: 125, stderr: 'missing directory' });
    await assert.rejects(
      connection.openTerminal(cwd, 80, 24, new AbortController().signal),
      /missing directory/,
    );
    assert.equal(calls.length, 0);
    assert.equal(connection.activeTasks, 0);
  }
  const { connection, calls } = fixture();
  const controller = new AbortController();
  connection.execCommand = async () => {
    controller.abort(new Error('cancelled'));
    return { exitCode: 0 };
  };
  await assert.rejects(connection.openTerminal('C:\\repo', 80, 24, controller.signal), /cancelled/);
  assert.equal(calls.length, 0);
  assert.equal(connection.activeTasks, 0);
});

test(
  'POSIX commands preserve literal paths, interactive input and exit status',
  {
    skip: process.platform === 'win32',
  },
  (t) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "alune 中文 ' $(false) ; "));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const commands = terminalShellCommands(cwd);
    const options = { encoding: 'utf8', env: { ...process.env, SHELL: '/bin/sh' }, timeout: 5000 };
    assert.equal(spawnSync('/bin/sh', ['-c', commands.check], options).status, 0);
    const result = spawnSync('/bin/sh', ['-c', commands.start], {
      ...options,
      input: 'pwd -P\nexit 7\n',
    });
    assert.ifError(result.error);
    assert.equal(result.stdout.trim(), fs.realpathSync(cwd));
    assert.equal(result.status, 7);
    assert.equal(
      spawnSync('/bin/sh', ['-c', terminalShellCommands(cwd + '/missing').check], options).status,
      125,
    );
    assert.equal(
      spawnSync('/bin/sh', ['-c', commands.check], {
        ...options,
        env: { ...options.env, SHELL: '/alune-missing-shell' },
      }).status,
      126,
    );
  },
);
