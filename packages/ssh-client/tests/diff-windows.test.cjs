const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, execFileSync } = require('node:child_process');
const { GitCommands, DIFF_PREVIEW_MAX_BYTES } = require('../dist/git-commands');

test('Windows diff rejects non-relative paths before contacting the remote host', async () => {
  const git = new GitCommands({
    execCommand() { throw new Error('must not connect'); },
  });
  for (const file of ['..\\outside.ts', 'dir\\..\\outside.ts', 'new.ts:stream', 'C:/outside.ts']) {
    await assert.rejects(git.diff('D:\\workspace\\mt_fe', { file }), /Windows 仓库/);
  }
});

test('Windows previews untracked and staged files with literal paths without changing the index', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Alune-diff-中文 ' "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', ['-C', root, ...args]);
  run('init', '-q');
  run('config', 'core.autocrlf', 'false');
  const connection = {
    execCommand(command, _cwd, _signal, options) {
      return new Promise((resolve, reject) => {
        exec(command, { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') return reject(error);
          try {
            resolve({
              exitCode: error?.code || 0,
              stdout: options?.strictUtf8
                ? new TextDecoder('utf-8', { fatal: true }).decode(stdout)
                : stdout.toString('utf8'),
              stderr: stderr.toString('utf8'),
            });
          } catch (error) { reject(error); }
        });
      });
    },
    withSftp(operation) { return operation(fs); },
  };
  const git = new GitCommands(connection);
  fs.mkdirSync(path.join(root, 'src/utils'), { recursive: true });
  for (const file of ['src/utils/statisticError.ts', "src/utils/中文 空格 $it's & [x].ts"]) {
    const target = path.join(root, file);
    fs.writeFileSync(target, 'export const message = "错误";\n');
    const before = run('--no-optional-locks', 'status', '--porcelain=v2', '-z');
    const patch = await git.diff(root, { file });
    assert.match(patch, /new file mode/);
    assert.match(patch, /\+export const message = "错误";/);
    assert.deepEqual(run('--no-optional-locks', 'status', '--porcelain=v2', '-z'), before);
    run('--literal-pathspecs', 'add', '--', file);
    const index = fs.readFileSync(path.join(root, '.git/index'));
    fs.unlinkSync(target);
    assert.match(await git.diff(root, { file, staged: true }), /\+export const message = "错误";/);
    assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), index);
  }
  fs.writeFileSync(path.join(root, 'large.ts'), 'x'.repeat(DIFF_PREVIEW_MAX_BYTES + 1));
  await assert.rejects(git.diff(root, { file: 'large.ts' }), /1 MiB/);
});
