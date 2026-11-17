// Every operation and ref below belongs to this smoke run's new repository.
// Keep cancelled and completed operations distinct and inspect Git independently.
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
    root = fs.mkdtempSync(path.join(path.dirname(repo), 'conflict-safety-'));
  const work = path.join(root, 'conflict-scope'),
    file = 'conflict.txt';
  fs.mkdirSync(work);
  const git = (...args) =>
    execFileSync('git', ['-C', work, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const bytes = () => fs.readFileSync(path.join(work, file), 'utf8');
  const body = (word) =>
    Array.from({ length: 20 }, (_, i) => 'before ' + i).join('\n') +
    '\n' +
    word +
    '\n' +
    Array.from({ length: 20 }, (_, i) => 'after ' + i).join('\n') +
    '\n';
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Conflict fixture');
  git('config', 'user.email', 'conflict@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  fs.writeFileSync(path.join(work, file), body('base'));
  git('add', '.');
  git('commit', '-qm', 'common ancestor');
  const remote = path.join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  git('remote', 'add', 'origin', remote);
  git('push', '-qu', 'origin', 'main');
  git('switch', '-qc', 'incoming');
  fs.writeFileSync(path.join(work, file), body('incoming'));
  git('commit', '-qam', 'incoming conflict');
  const incoming = git('rev-parse', 'HEAD');
  git('switch', '-q', 'main');
  fs.writeFileSync(path.join(work, file), body('current'));
  git('commit', '-qam', 'current conflict');
  const main = git('rev-parse', 'HEAD');
  const facts = () => ({
    head: git('rev-parse', 'HEAD'),
    refs: git('show-ref'),
    index: git('ls-files', '--stage'),
    work: bytes(),
  });
  const clean = facts();
  const merge = () => {
    assert.throws(() => git('merge', '--no-edit', 'incoming'));
    assert.ok(git('ls-files', '-u').includes(file));
  };
  const primary = (label) => textButton(label, '.a-dlg-actions button');
  const rebaseRunning = () =>
    fs.existsSync(path.join(work, '.git', 'rebase-merge')) ||
    fs.existsSync(path.join(work, '.git', 'rebase-apply'));
  async function fact(check, label) {
    for (let i = 0; i < 300; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error(label);
  }
  merge();
  await window.loadURL(origin + '/repositories');
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), work);
  await click(textButton('检查仓库'));
  await click(primary('打开工作区'));
  await wait(wc, element('.conflict-bar[aria-label="合并进行中"]'));
  const workspace = wc.getURL();
  const refresh = async (name) => {
    await window.loadURL(workspace);
    await click(element('button[aria-label^="改动"]'));
    await wait(wc, element('.conflict-bar[aria-label="' + name + '进行中"]'));
  };
  await refresh('合并');
  const conflicted = facts();
  await click(textButton('中止合并', '.conflict-bar button'));
  await wait(wc, primary('中止合并'));
  await pressKey(primary('取消'), 'Escape');
  await wait(wc, '!(' + primary('取消') + ')');
  assert.deepEqual(facts(), conflicted);
  await click(textButton('中止合并', '.conflict-bar button'));
  await wait(wc, element('.a-dlg-shell .dlg-check input'));
  assert.equal(await ev('(' + primary('中止合并') + ').disabled'), true);
  await click(element('.a-dlg-shell .dlg-check input'));
  await click(primary('中止合并'));
  await fact(
    () => !fs.existsSync(path.join(work, '.git', 'MERGE_HEAD')),
    'merge abort did not finish',
  );
  assert.deepEqual(facts(), clean);
  await pass(
    ['UI-010', 'UI-007'],
    'cancel merge abort with the unmerged index and marker bytes intact; acknowledged abort restores the exact pre-merge HEAD, refs, staged entries and working bytes',
  );

  merge();
  await refresh('合并');
  await click(element('button[aria-label^="查看差异 conflict.txt"]'));
  await wait(wc, element('.conflict-block'));
  await click(element('.conflict-fold'));
  await wait(
    wc,
    '[...document.querySelectorAll(".conflict-context")].some(e=>e.textContent.includes("before 0"))',
  );
  assert.deepEqual(facts(), conflicted);
  await pass(
    ['UI-010', 'UI-007', 'UI-011'],
    'expand omitted unchanged conflict context and verify the original first context line while the unmerged index, refs and marker bytes stay unchanged',
  );
  await click(textButton('标记为已解决', '.conflict-summary button'));
  await wait(wc, primary('仍然标记为已解决'));
  await click(primary('取消'));
  assert.deepEqual(facts(), conflicted);
  await click(textButton('标记为已解决', '.conflict-summary button'));
  await click(primary('仍然标记为已解决'));
  await fact(() => git('ls-files', '-u') === '', 'marker confirmation did not stage');
  assert.equal(git('show', ':' + file), conflicted.work.trimEnd());
  assert.equal(bytes(), conflicted.work);
  assert.equal(git('rev-parse', 'HEAD'), main);
  assert.equal(git('rev-parse', 'MERGE_HEAD'), incoming);
  await pass(
    ['UI-010', 'UI-007', 'UI-011', 'UI-072'],
    'cancel staging unresolved markers without changes, then explicitly confirm staging those exact marker bytes; the merge stays unfinished and no commit is created',
  );
  git('merge', '--abort');
  assert.deepEqual(facts(), clean);

  git('switch', '-q', 'incoming');
  assert.throws(() => git('rebase', 'main'));
  assert.ok(rebaseRunning());
  await refresh('变基');
  const paused = facts();
  await click(textButton('跳过此提交', '.conflict-bar button'));
  await click(primary('取消'));
  assert.deepEqual(facts(), paused);
  await click(textButton('跳过此提交', '.conflict-bar button'));
  await click(primary('跳过此提交'));
  await fact(() => !rebaseRunning(), 'ordinary rebase skip did not finish');
  assert.equal(git('branch', '--show-current'), 'incoming');
  assert.equal(git('rev-parse', 'HEAD'), main);
  assert.equal(bytes(), body('current'));
  assert.equal(git('ls-files', '-u'), '');
  await pass(
    ['UI-010', 'UI-007'],
    'ordinary Git rebase skip can be cancelled without changing the paused index; explicit skip drops the sole conflicting patch and returns its branch to the exact upstream commit',
  );
  git('reset', '--hard', incoming);
  const beforeRebase = facts();
  assert.throws(() => git('rebase', 'main'));
  await refresh('变基');
  await click(textButton('中止变基', '.conflict-bar button'));
  await wait(wc, element('.a-dlg-shell .dlg-check input'));
  assert.equal(await ev('(' + primary('中止变基') + ').disabled'), true);
  await click(element('.a-dlg-shell .dlg-check input'));
  await click(primary('中止变基'));
  await fact(() => !rebaseRunning(), 'ordinary rebase abort did not finish');
  assert.deepEqual(facts(), beforeRebase);
  assert.equal(git('branch', '--show-current'), 'incoming');
  await pass(
    ['UI-010', 'UI-007'],
    'ordinary Git rebase abort requires acknowledgement and restores the original branch commit, refs, staged entries and working bytes',
  );

  git('switch', '-q', 'main');
  merge();
  await refresh('合并');
  await click(element('button[aria-label^="查看差异 conflict.txt"]'));
  await wait(wc, element('.conflict-block'));
  const layout = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout ?? {
    sidebarCollapsed: false,
    changesCollapsed: false,
  };
  await click(button('专注解决冲突'));
  await wait(wc, 'document.querySelector(".workspace-body--right-hidden")');
  await fact(async () => {
    const current = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout;
    return current?.sidebarCollapsed && current?.changesCollapsed;
  }, 'focused panel preferences were not saved');
  const focused = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout;
  assert.equal(focused.sidebarCollapsed, true);
  assert.equal(focused.changesCollapsed, true);
  assert.deepEqual(facts(), conflicted);
  await click(button('关闭冲突视图'));
  await wait(wc, '!(' + element('.conflict-shell') + ')');
  assert.deepEqual(facts(), conflicted);
  // Restore the user's fixture layout through its persisted settings controls.
  await window.loadURL(origin + '/settings/layout');
  await wait(wc, button('显示左侧工作区'));
  for (const [label, key] of [
    ['显示左侧工作区', 'sidebarCollapsed'],
    ['显示右侧面板', 'changesCollapsed'],
  ])
    if ((await ev('(' + button(label) + ').getAttribute("aria-checked")')) !== String(!layout[key]))
      await click(button(label));
  await fact(async () => {
    const current = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout;
    return (
      current.sidebarCollapsed === layout.sidebarCollapsed &&
      current.changesCollapsed === layout.changesCollapsed
    );
  }, 'panel preferences were not restored');
  await refresh('合并');
  await click(element('button[aria-label^="查看差异 conflict.txt"]'));
  await wait(wc, element('.conflict-block'));
  await pass(
    ['UI-010', 'UI-007', 'UI-072', 'UI-011'],
    'focus and close the conflict view without changing Git; restore both panel preferences through settings and reopen the same conflicted file',
  );
  await click(textButton('整个文件采用传入', '.conflict-summary button'));
  await click(textButton('取消', '.ant-popover button'));
  assert.deepEqual(facts(), conflicted);
  await click(textButton('整个文件采用传入', '.conflict-summary button'));
  await click(textButton('采用传入', '.ant-popover button'));
  await fact(() => git('ls-files', '-u') === '', 'whole-file incoming choice did not stage');
  assert.equal(bytes(), body('incoming'));
  assert.equal(git('show', ':' + file), body('incoming').trimEnd());
  assert.equal(git('rev-parse', 'HEAD'), main);
  await click(textButton('继续合并', '.conflict-bar button'));
  await fact(
    () => !fs.existsSync(path.join(work, '.git', 'MERGE_HEAD')),
    'whole-file merge did not finish',
  );
  assert.equal(git('log', '-1', '--format=%P'), main + ' ' + incoming);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(bytes(), body('incoming'));
  await pass(
    ['UI-010', 'UI-007', 'UI-011', 'UI-072'],
    'cancel whole-file incoming choice without changes; confirm it stages the exact incoming blob, then continue merge and verify both parents and clean working bytes',
  );
  await window.loadURL(origin + '/repositories');
  await click(button('删除 conflict-scope'));
  await click(textButton('移除登记'));
  await wait(wc, '!(' + button('删除 conflict-scope') + ')');
  await window.loadURL(original);
};
