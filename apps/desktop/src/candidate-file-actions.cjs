// Exercise the registered workspace through its visible controls. The only
// external writes are fixture setup and a concurrent edit after preview.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({
  wc,
  work,
  git,
  wait,
  fact,
  button,
  element,
  click,
  fill,
  primary,
  textButton,
  pass,
}) => {
  const send = (expr, type, init) =>
    wait(
      wc,
      `(()=>{const e=(${expr});if(!e||e.disabled)return false;e.dispatchEvent(new ${type}(${JSON.stringify(init.type)},{bubbles:true,cancelable:true,...${JSON.stringify(init)}}));return true})()`,
    );
  const key = (expr, key, shiftKey = false) =>
    send(expr, 'KeyboardEvent', { type: 'keydown', key, shiftKey });
  const file = 'menu.txt',
    moved = 'renamed.txt',
    source = path.join(work, file),
    target = path.join(work, moved);
  const row = (name) => button('查看差异 ' + name + '（未暂存）');
  const item = (label) =>
    "[...document.querySelectorAll('.workspace-file-menu [role=menuitem]')].find(e=>e.getClientRects().length && e.textContent.trim()===" +
    JSON.stringify(label) +
    " && e.getAttribute('aria-disabled')!=='true' && !e.classList.contains('ant-dropdown-menu-item-disabled'))";
  fs.writeFileSync(source, 'staged bytes\n');
  git('add', '--', file);
  fs.writeFileSync(source, 'first preview\n');
  await click(button('刷新仓库'));
  await send(row(file), 'MouseEvent', { type: 'contextmenu', button: 2 });
  await click(item('重命名…'));
  const input = button('新文件名');
  await fill(input, '.git');
  await wait(
    wc,
    '(' +
      input +
      ')?.getAttribute("aria-invalid")==="true" && (' +
      primary('重命名') +
      ')?.disabled',
  );
  await fill(input, moved);
  await wait(wc, '(' + primary('重命名') + ')?.disabled===false');
  fs.writeFileSync(source, 'concurrent edit survives\n');
  await click(primary('重命名'));
  await wait(
    wc,
    "document.querySelector('.feedback-description')?.textContent.includes('重新读取并确认')",
  );
  assert.doesNotMatch(
    await wc.executeJavaScript("document.querySelector('.feedback-description').textContent"),
    /请勿重复执行/,
  );
  await click(primary('返回'));
  await wait(wc, textButton('重新读取并确认'));
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'concurrent edit survives\n');
  assert.equal(git('show', ':' + file), 'staged bytes');
  await click(textButton('重新读取并确认'));
  await click(primary('重命名'));
  await fact(
    () => fs.existsSync(target) && !fs.existsSync(source),
    'workspace rename did not finish',
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'concurrent edit survives\n');
  assert.equal(git('show', ':' + file), 'staged bytes');
  await pass(
    ['UI-048'],
    'mouse file menu: invalid name cannot submit; stale rename preserves both versions; reread then rename moves only working bytes',
  );

  async function openDelete() {
    await wait(wc, "!document.querySelector('.a-dlg-shell')");
    await key(row(moved), 'F10', true);
    await click(item('删除文件…'));
    await wait(wc, '(' + primary('永久删除') + ')?.disabled===true');
  }
  await openDelete();
  await click(primary('取消'));
  await wait(wc, '!(' + primary('永久删除') + ')');
  assert.equal(fs.readFileSync(target, 'utf8'), 'concurrent edit survives\n');
  await openDelete();
  await click(element('.a-dlg-shell input[type=checkbox]'));
  await click(primary('永久删除'));
  await fact(() => !fs.existsSync(target), 'confirmed workspace deletion did not finish');
  assert.equal(git('show', ':' + file), 'staged bytes');
  assert.equal(git('diff', '--cached', '--name-only'), file);
  await pass(
    ['UI-048'],
    'Shift+F10 file menu: cancel preserves the file; acknowledging deletes the working file and preserves the original staged blob',
  );
  git('rm', '--cached', '--', file);
  await click(button('刷新仓库'));
  assert.equal(git('status', '--porcelain'), '');

  // Append two lines to a tracked file. Stage only the first, then discard
  // only the second. Inspect HEAD, index and disk independently at each step.
  const tracked = 'scratch.txt',
    trackedPath = path.join(work, tracked);
  const original = fs.readFileSync(trackedPath, 'utf8');
  const baseLines = original.trimEnd().split('\n').length;
  const first = original + 'selected addition\n';
  const both = first + 'unselected addition\n';
  const blob = () => git('show', ':' + tracked);
  const line = (i) => button('选择新增行 ' + (baseLines + i));
  async function prepareLine(i) {
    const enable = button('开启按行操作');
    await wait(wc, '(' + line(i) + ') || (' + enable + ')');
    if (!(await wc.executeJavaScript('Boolean(' + line(i) + ')'))) await click(enable);
    await wait(wc, '(' + line(i) + ')?.disabled===false');
  }
  async function lineAction(label) {
    const direct = textButton(label);
    if (await wc.executeJavaScript('Boolean(' + direct + ')')) return click(direct);
    await click(button('更多按行操作'));
    await click(
      "[...document.querySelectorAll('[role=menuitem]')].find(e=>e.getClientRects().length && e.textContent.trim()===" +
        JSON.stringify(label) +
        ')',
    );
  }
  fs.writeFileSync(trackedPath, both);
  await click(button('刷新仓库'));
  await click(row(tracked));
  await prepareLine(1);
  await click(line(1));
  await lineAction('清除选择');
  await wait(wc, '(' + line(1) + ')?.checked===false');
  await click(line(1));
  await lineAction('暂存所选行');
  await fact(() => blob() === first.trimEnd(), 'selected line did not reach index');
  assert.equal(fs.readFileSync(trackedPath, 'utf8'), both);
  assert.equal(git('show', 'HEAD:' + tracked), original.trimEnd());
  await wait(wc, button('取消暂存 ' + tracked));
  await click(row(tracked));
  await prepareLine(2);
  await click(line(2));
  await lineAction('放弃所选行');
  const confirm = element('[aria-label="确认放弃改动"]');
  await key(confirm, 'Escape');
  await wait(wc, '!(' + confirm + ')');
  assert.equal(fs.readFileSync(trackedPath, 'utf8'), both);
  await lineAction('放弃所选行');
  await click(textButton('确认放弃'));
  await fact(
    () => fs.readFileSync(trackedPath, 'utf8') === first,
    'only the unstaged addition should be discarded',
  );
  assert.equal(blob(), first.trimEnd());
  assert.equal(git('show', 'HEAD:' + tracked), original.trimEnd());
  await pass(
    ['UI-063', 'UI-007'],
    'clear a line selection, stage only one of two adjacent additions, cancel then confirm discarding the other; verify HEAD, index and working bytes',
  );
  await click(button('取消暂存 ' + tracked));
  await fact(() => blob() === original.trimEnd(), 'unstage did not restore original index');
  assert.equal(fs.readFileSync(trackedPath, 'utf8'), first);
  git('restore', '--worktree', '--', tracked);
  await click(button('刷新仓库'));

  const search = button('筛选分支'),
    pill = (name) => button('当前分支 ' + name + '，切换分支');
  const option = (name) => element('[role=option][aria-label="切换到 ' + name + '"]');
  await key(pill('main'), 'ArrowDown');
  await wait(wc, option('incoming'));
  await key(search, 'Escape');
  await wait(wc, '(' + pill('main') + ')?.getAttribute("aria-expanded")==="false"');
  assert.equal(git('branch', '--show-current'), 'main');
  for (const [from, to] of [
    ['main', 'incoming'],
    ['incoming', 'main'],
  ]) {
    await key(pill(from), 'ArrowDown');
    await fill(search, to);
    await wait(wc, '(' + option(to) + ')?.getAttribute("aria-selected")==="true"');
    await key(search, 'Enter');
    await fact(() => git('branch', '--show-current') === to, 'branch keyboard selection failed');
    await wait(wc, pill(to));
  }
  await pass(
    ['UI-005'],
    'keyboard branch picker: Escape preserves HEAD, then filtered Enter switches both ways and Git confirms each branch',
  );
};
