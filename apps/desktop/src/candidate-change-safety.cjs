// Destructive controls operate only on a new repository under the smoke root.
// Use independent Git and byte assertions for each confirmation boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, repo, wait, pass }) => {
  const wc = window.webContents,
    ev = (code) => wc.executeJavaScript(code);
  const { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const original = wc.getURL(),
    base = fs.mkdtempSync(path.join(path.dirname(repo), 'change-safety-'));
  const work = path.join(base, 'discard-scope'),
    linked = path.join(base, 'linked');
  fs.mkdirSync(work);
  const at = (directory, ...args) =>
    execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => at(work, ...args);
  const write = (name, bytes) => fs.writeFileSync(path.join(work, name), bytes);
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Change safety fixture');
  git('config', 'user.email', 'change-safety@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  write('.gitignore', 'ignored.txt\n');
  write('tracked.txt', 'committed bytes\n');
  git('add', '.');
  git('commit', '-qm', 'discard fixture');
  git('worktree', 'add', '-qb', 'other-worktree', linked);
  fs.writeFileSync(path.join(linked, 'tracked.txt'), 'other worktree bytes\n');
  const nested = path.join(work, 'nested');
  fs.mkdirSync(nested);
  at(nested, 'init', '-qb', 'main');
  at(nested, 'config', 'user.name', 'Nested fixture');
  at(nested, 'config', 'user.email', 'nested@example.invalid');
  at(nested, 'config', 'commit.gpgSign', 'false');
  fs.writeFileSync(path.join(nested, 'keep.txt'), 'nested bytes\n');
  at(nested, 'add', '.');
  at(nested, 'commit', '-qm', 'nested fixture');
  write('tracked.txt', 'staged bytes\n');
  write('staged-new.txt', 'staged new bytes\n');
  git('add', '--', 'tracked.txt', 'staged-new.txt');
  write('tracked.txt', 'unstaged tracked bytes\n');
  write('staged-new.txt', 'unstaged new bytes\n');
  write('loose.txt', 'untracked bytes\n');
  write('ignored.txt', 'ignored bytes\n');
  const metadata = () => ({
    head: git('rev-parse', 'HEAD'),
    index: git('ls-files', '--stage'),
    refs: git('show-ref'),
  });
  const before = metadata(),
    nestedHead = at(nested, 'rev-parse', 'HEAD');
  const unaffected = () => {
    assert.deepEqual(metadata(), before);
    assert.equal(fs.readFileSync(path.join(work, 'ignored.txt'), 'utf8'), 'ignored bytes\n');
    assert.equal(fs.readFileSync(path.join(nested, 'keep.txt'), 'utf8'), 'nested bytes\n');
    assert.equal(at(nested, 'rev-parse', 'HEAD'), nestedHead);
    assert.equal(
      fs.readFileSync(path.join(linked, 'tracked.txt'), 'utf8'),
      'other worktree bytes\n',
    );
  };
  const working = () =>
    Object.fromEntries(
      ['tracked.txt', 'staged-new.txt', 'loose.txt'].map((name) => [
        name,
        fs.readFileSync(path.join(work, name), 'utf8'),
      ]),
    );
  const untouched = working();
  await window.loadURL(origin + '/repositories');
  await wait(wc, button('打开本地仓库'));
  const sessionBefore = await ev(
    'JSON.parse(window.aluneWorkspace.load()).state.repositorySession',
  );
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), path.join(base, 'not-registered'));
  await click(textButton('取消', '.a-dlg-actions button'));
  await wait(wc, '!(' + element('#local-repo-path') + ')');
  unaffected();
  assert.deepEqual(
    await ev('JSON.parse(window.aluneWorkspace.load()).state.repositorySession'),
    sessionBefore,
  );
  assert.equal(fs.existsSync(path.join(base, 'not-registered')), false);
  await pass(
    ['UI-028'],
    'cancelling local repository opening retains the saved workspace session and does not create the typed nonexistent directory',
  );
  await click(button('打开本地仓库'));
  await wait(wc, element('#local-repo-path'));
  assert.equal(await ev('(' + element('#local-repo-path') + ').value'), '');
  await input(element('#local-repo-path'), work);
  await ev('(' + element('#local-repo-path') + ').focus()');
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await wait(wc, '(' + textButton('打开工作区', '.a-dlg-actions button') + ')?.disabled===false');
  assert.equal(await ev('location.pathname'), '/repositories');
  unaffected();
  await click(textButton('打开工作区', '.a-dlg-actions button'));
  await wait(wc, button('暂存 tracked.txt'));
  const currentId = new URL(wc.getURL()).pathname.split('/').at(-1);
  await pass(
    ['UI-028'],
    'native Enter inspects a real repository without registering it; explicit Open then selects the checked path and preserves its staged and unstaged state',
  );
  const primary = (label) => textButton(label, '.a-dlg-actions button');
  const checks = '.a-dlg-shell[data-level="2"] .dlg-check input';
  const check = (index) =>
    '(' +
    element('.a-dlg-shell[data-level="2"]') +
    ').querySelectorAll(".dlg-check input")[' +
    index +
    ']';
  const acknowledge = () => click(check(1));
  const open = async () => {
    await click(button('放弃所有更改'));
    await wait(wc, 'document.querySelectorAll(' + JSON.stringify(checks) + ').length===2');
    await wait(wc, primary('仅放弃已跟踪更改（2）'));
  };
  const closed = () => wait(wc, '!(' + element('.a-dlg-shell[data-level="2"]') + ')');
  await input(button('筛选改动文件'), 'tracked.txt');
  await open();
  assert.equal(await ev('(' + check(0) + ').checked'), false);
  assert.equal(await ev('(' + primary('仅放弃已跟踪更改（2）') + ').disabled'), true);
  await click(primary('取消'));
  await closed();
  unaffected();
  assert.deepEqual(working(), untouched);
  await pass(
    ['UI-007', 'UI-016'],
    'filtered change list still previews both tracked files across the whole repository; cancellation preserves staged, unstaged, untracked, ignored, nested-repository and other-worktree bytes',
  );

  await open();
  await acknowledge();
  write('tracked.txt', 'concurrent edit after preview\n');
  await click(primary('仅放弃已跟踪更改（2）'));
  await wait(wc, element('.a-dlg-shell .feedback-description'));
  assert.match(
    await ev('(' + element('.a-dlg-shell .feedback-description') + ').textContent'),
    /变化|重新|过期/,
  );
  unaffected();
  assert.deepEqual(working(), { ...untouched, 'tracked.txt': 'concurrent edit after preview\n' });
  await click(primary('返回'));
  await wait(wc, primary('确认放弃'));
  assert.equal(await ev('(' + primary('确认放弃') + ').disabled'), true);
  await pass(
    ['UI-007', 'UI-016'],
    'a concurrent byte edit invalidates the repository-wide discard preview; the failed confirmation changes neither index nor any target and cannot be resubmitted with its old acknowledgement',
  );

  await click(textButton('重新读取并确认', '.a-dlg-shell button'));
  await wait(wc, primary('仅放弃已跟踪更改（2）'));
  assert.equal(await ev('(' + check(1) + ').checked'), false);
  await acknowledge();
  await click(primary('仅放弃已跟踪更改（2）'));
  await closed();
  unaffected();
  assert.deepEqual(working(), {
    'tracked.txt': 'staged bytes\n',
    'staged-new.txt': 'staged new bytes\n',
    'loose.txt': 'untracked bytes\n',
  });
  await pass(
    ['UI-007', 'UI-016'],
    'explicit reread resets acknowledgement; tracked-only discard restores both files to their staged blobs and preserves untracked, ignored, nested-repository and other-worktree content',
  );

  write('tracked.txt', 'second tracked change\n');
  write('staged-new.txt', 'second staged-new change\n');
  await input(button('筛选改动文件'), '');
  await click(button('刷新仓库'));
  await wait(wc, button('暂存 tracked.txt'));
  await open();
  await acknowledge();
  await click(check(0));
  await wait(wc, primary('放弃全部并删除（3）'));
  assert.equal(await ev('(' + check(1) + ').checked'), false);
  assert.equal(await ev('(' + primary('放弃全部并删除（3）') + ').disabled'), true);
  await acknowledge();
  await click(primary('放弃全部并删除（3）'));
  await closed();
  unaffected();
  assert.equal(fs.existsSync(path.join(work, 'loose.txt')), false);
  assert.equal(fs.readFileSync(path.join(work, 'tracked.txt'), 'utf8'), 'staged bytes\n');
  assert.equal(fs.readFileSync(path.join(work, 'staged-new.txt'), 'utf8'), 'staged new bytes\n');
  await pass(
    ['UI-007', 'UI-016'],
    'expanding discard to untracked files clears prior consent; fresh confirmation deletes only the loose file, restores working bytes and retains staged-new blobs, ignored files, the nested repository and dirty linked worktree',
  );

  write('tracked.txt', 'single-file discard bytes\n');
  await click(button('刷新仓库'));
  await wait(wc, button('丢弃 tracked.txt'));
  const trigger = button('丢弃 tracked.txt');
  await click(trigger);
  const confirm = textButton('丢弃改动', '.ant-popover button');
  const consent = element('.ant-popover .dlg-check input');
  await wait(wc, consent);
  assert.equal(await ev('(' + confirm + ').disabled'), true);
  await click(consent);
  await click(textButton('取消', '.ant-popover button'));
  assert.equal(
    fs.readFileSync(path.join(work, 'tracked.txt'), 'utf8'),
    'single-file discard bytes\n',
  );
  await click(trigger);
  await wait(wc, consent);
  assert.equal(await ev('(' + consent + ').checked'), false);
  assert.equal(await ev('(' + confirm + ').disabled'), true);
  await click(consent);
  await click(confirm);
  await wait(wc, '!(' + trigger + ')');
  unaffected();
  assert.equal(fs.readFileSync(path.join(work, 'tracked.txt'), 'utf8'), 'staged bytes\n');
  await pass(
    ['UI-007'],
    'single-file discard requires new consent after cancellation, restores the exact staged blob and preserves HEAD, all index entries and the other repository scopes',
  );
  await require('./candidate-repository-navigation.cjs')({
    window,
    origin,
    current: { id: currentId, path: work },
    other: { id: new URL(original).pathname.split('/').at(-1), path: repo },
    wait,
    pass,
  });
  await window.loadURL(origin + '/repositories');
  await click(button('删除 discard-scope'));
  await click(textButton('移除登记'));
  await wait(wc, '!(' + button('删除 discard-scope') + ')');
  await window.loadURL(original);
};
