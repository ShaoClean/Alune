// Destructive controls operate only on a new repository under the smoke root.
// Use independent Git and byte assertions for each confirmation boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, repo, wait, pass }) => {
  const wc = window.webContents,
    ev = (code) => wc.executeJavaScript(code);
  const { element, button, textButton, click, input, pressKey } = require('./candidate-ui-driver.cjs')(
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
  // Give navigation the same ready-to-use context as the original fixture;
  // missing-remote guidance is exercised separately by the context scenarios.
  const remote = path.join(base, 'origin.git');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  git('remote', 'add', 'origin', remote);
  git('push', '-qu', 'origin', 'main');
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
  const sessionBefore = JSON.parse(await ev('window.aluneWorkspace.load()')).state
    .repositorySession;
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), path.join(base, 'not-registered'));
  // Use the actual current dialog's button and native pointer activation. A
  // keyDown/keyUp-only Enter injection does not generate a button click on Mac.
  await require('./smoke-window.cjs')(window);
  const cancelPoint = await ev(`(()=>{const e=(${textButton('取消', '.ant-modal:has(#local-repo-path) .a-dlg-actions button')});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  wc.sendInputEvent({type:'mouseMove',...cancelPoint});
  wc.sendInputEvent({type:'mouseDown',...cancelPoint,button:'left',clickCount:1});
  wc.sendInputEvent({type:'mouseUp',...cancelPoint,button:'left',clickCount:1});
  await wait(wc, '!(' + element('#local-repo-path') + ')');
  unaffected();
  assert.deepEqual(
    JSON.parse(await ev('window.aluneWorkspace.load()')).state.repositorySession,
    sessionBefore,
  );
  assert.equal(fs.existsSync(path.join(base, 'not-registered')), false);
  await pass(
    ['UI-028', 'UI-025'],
    'cancelling local repository opening retains the saved workspace session and does not create the typed nonexistent directory',
  );
  await click(button('打开本地仓库'));
  await wait(wc, element('#local-repo-path'));
  // P0 keeps the cancelled path draft; reopening must not treat it as an
  // inspected repository or enable opening until the user checks a valid path.
  assert.equal(
    await ev('(' + element('#local-repo-path') + ').value'),
    path.join(base, 'not-registered'),
  );
  assert.equal(
    await ev('(' + textButton('打开工作区', '.a-dlg-actions button') + ').disabled'),
    true,
  );
  await require('./smoke-window.cjs')(window);
  await input(element('#local-repo-path'), work);
  await pressKey(element('#local-repo-path'), 'Return');
  await wait(wc, '(' + textButton('打开工作区', '.a-dlg-actions button') + ')?.disabled===false');
  assert.equal(await ev('location.pathname'), '/repositories');
  unaffected();
  await click(textButton('打开工作区', '.a-dlg-actions button'));
  await wait(wc, button('暂存 tracked.txt'));
  const currentId = new URL(wc.getURL()).pathname.split('/').at(-1);
  await pass(
    ['UI-028', 'UI-025'],
    'reopen retains the cancelled path draft as in P0 but cannot open it; native Enter inspects a valid repository without registering it, and explicit Open selects that checked path without changing Git state',
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
    ['UI-007', 'UI-016', 'UI-042'],
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
  // A partially staged path has two selectable rows, but only one working file.
  write('tracked.txt', 'selected working bytes\n');
  write('staged-new.txt', 'unchecked working bytes\n');
  write('batch-1.txt', 'one\n');
  write('batch-2.txt', 'two\n');
  write('batch-3.txt', 'three\n');
  await click(button('刷新仓库'));
  const checkedRow = (name, staged = false) =>
    button(`选择 ${name}（${staged ? '已暂存' : '未暂存'}）`);
  const batch = (label) => textButton(label, '.changes-selection button');
  const filter = button('筛选改动文件');
  const preview = button('查看差异 tracked.txt（未暂存）');
  await click(preview);
  await click(checkedRow('tracked.txt', true));
  const stagedGroup = `(${button('全选可见的已暂存改动')}).parentElement.querySelector('.change-group__title')`;
  await click(stagedGroup);
  await wait(wc, `!(${element('.changes-selection')})`);
  await click(stagedGroup);
  await click(checkedRow('tracked.txt', true));
  await input(filter, 'batch-');
  await wait(wc, `!(${element('.changes-selection')})`);
  await click(button('全选可见的未暂存改动'));
  await input(filter, '');
  await wait(wc, `(${button('全选可见的未暂存改动')})?.indeterminate`);
  await click(batch('清除选择'));
  await click(checkedRow('batch-1.txt'));
  await ev(
    `(${checkedRow('batch-3.txt')}).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`,
  );
  await wait(wc, batch('暂存 3 项'));
  await pressKey(checkedRow('batch-3.txt'), ' ');
  await wait(wc, batch('暂存 2 项'));
  await click(checkedRow('tracked.txt', true));
  await ev(`(${preview}).dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))`);
  await wait(wc, batch('暂存 3 项'));
  assert.equal(await ev(`(${preview}).ariaPressed`), 'true');
  await click(batch('放弃 1 项'));
  await wait(wc, primary('放弃所选改动'));
  assert.deepEqual(
    await ev(
      `[...document.querySelectorAll('.a-dlg-shell .dlg-list-item .dlg-path')].map(e => e.title)`,
    ),
    ['tracked.txt'],
  );
  await click(primary('取消'));
  await closed();
  assert.equal(fs.readFileSync(path.join(work, 'tracked.txt'), 'utf8'), 'selected working bytes\n');
  await click(batch('放弃 1 项'));
  await click(check(0));
  await click(primary('放弃所选改动'));
  await closed();
  await wait(wc, batch('暂存 2 项'));
  unaffected();
  assert.equal(fs.readFileSync(path.join(work, 'tracked.txt'), 'utf8'), 'staged bytes\n');
  assert.equal(
    fs.readFileSync(path.join(work, 'staged-new.txt'), 'utf8'),
    'unchecked working bytes\n',
  );
  const indexLock = path.join(work, '.git/index.lock');
  fs.writeFileSync(indexLock, '', { flag: 'wx' });
  try {
    await click(batch('暂存 2 项'));
    await wait(wc, `(${element('.feedback-dialog[open]')})?.innerText.includes('index.lock')`);
    assert.equal(git('ls-files', '--stage'), before.index);
    await click(button('关闭提示'));
  } finally {
    fs.unlinkSync(indexLock);
  }
  await click(batch('暂存 2 项'));
  await wait(wc, checkedRow('batch-2.txt', true));
  assert.equal(git('show', ':batch-1.txt'), 'one');
  assert.equal(git('show', ':batch-2.txt'), 'two');
  await click(checkedRow('batch-1.txt', true));
  await click(batch('取消暂存 2 项'));
  await wait(wc, checkedRow('batch-1.txt'));
  assert.equal(git('diff', '--cached', '--name-only', '--', 'batch-1.txt', 'tracked.txt'), '');
  assert.equal(git('show', ':batch-2.txt'), 'two');
  assert.equal(git('show', ':staged-new.txt'), 'staged new bytes');
  assert.equal(fs.readFileSync(path.join(work, 'batch-1.txt'), 'utf8'), 'one\n');
  await pass(
    ['UI-007'],
    'filtered and cross-group selection limits stage, unstage and confirmed discard to the indicated paths and preserves the active comparison and other working files',
  );

  await require('./candidate-repository-navigation.cjs')({
    window,
    origin,
    current: {
      id: currentId,
      path:
        process.platform === 'win32'
          ? fs.realpathSync.native(work).replaceAll('\\', '/')
          : fs.realpathSync.native(work),
    },
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
