const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, wc, scratchUrl, linked, git, wait, fact, pass }) => {
  const { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const ev = (s) => wc.executeJavaScript(s),
    primary = (t) => textButton(t, '.a-dlg-actions button');
  const original = wc.getURL(),
    head = git('rev-parse', 'HEAD'),
    branch = 'ui-remove-worktree';
  const dir = path.join(path.dirname(linked), 'removal-worktree'),
    marker = path.join(dir, 'unsaved-worktree-proof.txt');
  const trigger = button('查看关联 Worktrees'),
    panel = element('.worktrees-menu');
  await wait(
    wc,
    `(()=>{const b=(${trigger});if(!b)return false;b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));return true})()`,
  );
  await wait(wc, panel);
  await ev(
    `(()=>{const e=(${panel});e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))})()`,
  );
  await wait(wc, '!(' + panel + ')&&document.activeElement===(' + trigger + ')');
  await pass(
    ['UI-052', 'UI-053'],
    'open the Worktree panel from the keyboard, Escape closes it and returns focus to the toolbar',
  );
  await click(button('查看关联 Worktrees'));
  await click(button('新建本地 Worktree'));
  await input(element('#worktree-path'), dir);
  await input(element('#worktree-branch'), branch);
  await click(primary('取消'));
  assert.equal(fs.existsSync(dir), false);
  assert.equal(git('branch', '--list', branch), '');
  await click(button('新建本地 Worktree'));
  await click(primary('创建并打开'));
  await fact(() => fs.existsSync(path.join(dir, '.git')), 'new worktree missing');
  await wait(
    wc,
    'document.querySelector(".branch-pill__name")?.textContent.trim()===' + JSON.stringify(branch),
  );
  const created = new URL(wc.getURL()).pathname.split('/').at(-1);
  assert.equal(
    execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    head,
  );
  await window.loadURL(scratchUrl);
  await click(button('查看关联 Worktrees'));
  const row =
    '[...document.querySelectorAll(".worktree-entry")].find(e=>e.getClientRects().length&&e.querySelector(".worktree-option__name")?.textContent===' +
    JSON.stringify(branch) +
    ')';
  const more = '(' + row + ')?.querySelector("button[aria-haspopup=menu]")';
  await wait(wc, row);
  const displayed = await ev('(' + row + ').querySelector(".worktree-option__path").textContent');
  assert.equal(fs.realpathSync.native(displayed), fs.realpathSync.native(dir));
  const refresh = async () => {
    await click(button('刷新 Worktree 列表'));
    await wait(wc, row);
  };
  git('worktree', 'lock', '--reason', 'keep-test-worktree', dir);
  await refresh();
  await wait(wc, '(' + row + ')?.innerText.includes("keep-test-worktree")');
  assert.equal(await ev('!!(' + more + ')'), false);
  git('worktree', 'unlock', dir);
  await refresh();
  await wait(wc, more);
  await pass(
    ['UI-053', 'UI-052'],
    'cancel creation without a branch or directory, create and open a real worktree, then refresh a Git lock and verify directory removal is unavailable while locked',
  );
  await click(more);
  await wait(wc, element('[role=menu]'));
  await wait(
    wc,
    '(()=>{const menu=(' +
      element('[role=menu]') +
      ');return !!menu&&menu.contains(document.activeElement)})()',
  );
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(
    wc,
    '(' +
      more +
      ')?.getAttribute("aria-expanded")==="false"&&document.activeElement===(' +
      more +
      ')',
  );
  async function removeDialog() {
    await click(more);
    await click(textButton('删除目录…', '.ant-dropdown-menu-item'));
    await wait(wc, primary('删除目录'));
  }
  await removeDialog();
  assert.equal(await ev('(' + primary('删除目录') + ').disabled'), true);
  await click(primary('取消'));
  assert.equal(fs.existsSync(dir), true);
  fs.writeFileSync(marker, 'do not remove this untracked file\n');
  await removeDialog();
  await click(element('.a-dlg-shell .dlg-check input'));
  await click(primary('删除目录'));
  await wait(wc, primary('返回'));
  const failure = await ev('(' + element('.a-dlg-shell .feedback-description') + ').textContent');
  assert.match(failure, /改动|未跟踪|忽略|干净|删除/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'do not remove this untracked file\n');
  assert.equal(git('rev-parse', branch), head);
  await click(primary('返回'));
  await click(primary('取消'));
  await pass(
    ['UI-053'],
    'dismiss the worktree menu with Escape and preserve focus; cancel removal and reject acknowledged removal of an untracked file without changing its bytes or branch',
  );
  fs.unlinkSync(marker);
  await refresh();
  await removeDialog();
  await click(element('.a-dlg-shell .dlg-check input'));
  await click(primary('删除目录'));
  await fact(() => !fs.existsSync(dir), 'clean worktree directory was not removed');
  await wait(wc, '!(' + row + ')');
  assert.equal(git('rev-parse', branch), head);
  assert.ok(fs.existsSync(path.join(linked, '.git')));
  assert.ok(!git('worktree', 'list', '--porcelain').includes('removal-worktree'));
  const existing =
    '[...document.querySelectorAll(".worktree-option")].find(e=>e.getClientRects().length&&e.querySelector(".worktree-option__name")?.textContent==="ui-linked")';
  await wait(wc, existing);
  assert.equal(
    fs.realpathSync.native(
      await ev('(' + existing + ').querySelector(".worktree-option__path").textContent'),
    ),
    fs.realpathSync.native(linked),
  );
  await click(existing);
  await wait(wc, 'location.pathname===' + JSON.stringify(new URL(original).pathname));
  await wait(wc, 'document.querySelector(".branch-pill__name")?.textContent.trim()==="ui-linked"');
  const saved = JSON.parse(await ev('window.aluneWorkspace.load()')).state.repositorySession;
  assert.ok(!saved.ids.includes(created));
  assert.equal(saved.activeId, new URL(original).pathname.split('/').at(-1));
  await pass(
    ['UI-053', 'UI-025'],
    'after removing only the test sentinel, explicitly remove the clean directory; Git registration and its tab disappear, while its branch, the other worktree and the original selected repository survive',
  );
};
