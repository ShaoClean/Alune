const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, repo, wait, pass }) => {
  const wc = window.webContents,
    ev = (s) => wc.executeJavaScript(s);
  const { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const original = wc.getURL(),
    base = fs.mkdtempSync(path.join(path.dirname(repo), 'file-recovery-ui-')),
    work = path.join(base, 'image-and-new-file');
  fs.mkdirSync(work);
  const git = (...args) =>
    execFileSync('git', ['-C', work, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-qb', 'main');
  git('config', 'user.name', 'File fixture');
  git('config', 'user.email', 'files@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=',
    'base64',
  );
  fs.writeFileSync(path.join(work, 'pixel.png'), png);
  git('add', '.');
  git('commit', '-qm', 'image fixture');
  const bare = path.join(base, 'origin.git');
  execFileSync('git', ['init', '--bare', '-q', bare]);
  git('remote', 'add', 'origin', bare);
  const head = git('rev-parse', 'HEAD'),
    indexBefore = git('ls-files', '--stage');
  const damaged = png.subarray(0, 8);
  fs.writeFileSync(path.join(work, 'pixel.png'), damaged);
  await window.loadURL(origin + '/repositories');
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), work);
  await click(textButton('检查仓库'));
  await click(textButton('打开工作区', '.a-dlg-actions button'));
  await click(button('查看差异 pixel.png（未暂存）'));
  await wait(
    wc,
    "document.querySelector('.image-diff-pane:first-child img')?.naturalWidth===1&&document.querySelector('.image-diff-pane:first-child figcaption')?.textContent.includes('1×1')",
  );
  await wait(
    wc,
    "document.querySelector('.feedback-dialog[open] #feedback-title')?.textContent.includes('图片无法解码')",
  );
  assert.equal(await ev("document.querySelector('.image-diff-pane:last-child img')===null"), true);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('ls-files', '--stage'), indexBefore);
  assert.deepEqual(fs.readFileSync(path.join(work, 'pixel.png')), damaged);
  await pass(
    ['UI-023', 'UI-015'],
    'decode the committed PNG into its actual 1×1 dimensions, report the deliberately truncated working PNG as undecodable and preserve both original bytes and Git index',
  );
  await click(element('.feedback-dialog[open] [aria-label="关闭提示"]'));
  await click(button('关闭差异'));
  const file = path.join(work, 'new.txt'),
    primary = (label) => textButton(label, '.a-dlg-actions button');
  fs.writeFileSync(file, 'staged new bytes\n');
  git('add', 'new.txt');
  fs.writeFileSync(file, 'unsaved new bytes\n');
  const newBlob = git('rev-parse', ':new.txt');
  await click(button('刷新仓库'));
  const trigger = button('删除整个新增文件 new.txt（已暂存）');
  await click(trigger);
  const check = element('.a-dlg-shell .dlg-check input');
  await wait(wc, check);
  assert.equal(await ev('(' + primary('删除文件') + ').disabled'), true);
  await click(primary('取消'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'unsaved new bytes\n');
  assert.equal(git('rev-parse', ':new.txt'), newBlob);
  await pass(
    ['UI-014', 'UI-007'],
    'the new-file deletion dialog requires acknowledgement; cancellation preserves the different staged and working versions of the same newly added file',
  );
  await click(trigger);
  await wait(wc, check);
  fs.writeFileSync(file, 'concurrent new bytes\n');
  await click(check);
  await click(primary('删除文件'));
  await wait(wc, primary('返回'));
  assert.match(
    await ev('(' + element('.a-dlg-shell .feedback-description') + ').textContent'),
    /变化|重新|确认|过期/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'concurrent new bytes\n');
  assert.equal(git('rev-parse', ':new.txt'), newBlob);
  await click(primary('返回'));
  await click(textButton('重新读取并确认', '.a-dlg-shell button'));
  await wait(wc, check);
  assert.equal(await ev('(' + check + ').checked'), false);
  assert.equal(await ev('(' + primary('删除文件') + ').disabled'), true);
  await click(check);
  await click(primary('删除文件'));
  await wait(wc, '!(' + trigger + ')&&!(' + primary('删除文件') + ')');
  assert.equal(fs.existsSync(file), false);
  assert.throws(() => git('rev-parse', '--verify', ':new.txt'));
  assert.equal(git('ls-files', '--stage'), indexBefore);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.deepEqual(fs.readFileSync(path.join(work, 'pixel.png')), damaged);
  await pass(
    ['UI-014', 'UI-007'],
    'a concurrent edit invalidates the deletion preview without removing either version; explicit reread resets acknowledgement, and a second confirmation removes only the new file and its staged addition',
  );
  await window.loadURL(origin + '/repositories');
  await click(button('删除 image-and-new-file'));
  await click(textButton('移除登记'));
  await wait(wc, '!(' + button('删除 image-and-new-file') + ')');
  await window.loadURL(original);
};
