const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { dialog } = require('electron');

module.exports = async ({ window, repositoryTray, repo, id, linkedId, wait }) => {
  assert.ok(repositoryTray, 'packaged tray icon and menu created');
  const contents = window.webContents;
  const run = (script) => contents.executeJavaScript(script);
  const prefs = await run('window.aluneTray.getPreferences()');
  assert.equal(prefs.available, true);
  assert.equal(prefs.closeMode, 'ask');
  const branchItem = (name) =>
    repositoryTray.menu.items.find(
      (item) => item.type === 'checkbox' && item.checked && item.label.endsWith(' · ' + name),
    );
  async function waitBranch(name, timeout) {
    const until = Date.now() + timeout;
    while (!branchItem(name) && Date.now() < until) await delay(100);
    assert.ok(branchItem(name), 'native tray followed ' + name);
  }
  await waitBranch('main', 15000);
  const linked = repositoryTray.menu.items.find(
    (item) => item.type === 'checkbox' && !item.checked,
  );
  assert.ok(linked.label.includes('second'), 'same-named linked worktree has a distinct label');
  linked.click();
  await wait(contents, 'location.pathname === ' + JSON.stringify('/repositories/' + linkedId));
  await waitBranch('tray-linked', 15000);
  repositoryTray.menu.items.find((item) => item.type === 'checkbox' && !item.checked).click();
  await wait(contents, 'location.pathname === ' + JSON.stringify('/repositories/' + id));
  await waitBranch('main', 15000);
  const prompt = dialog.showMessageBox;
  const responses = [2, 0];
  try {
    dialog.showMessageBox = async (owner, options) => {
      assert.equal(owner, window);
      assert.equal(options.cancelId, 2);
      assert.equal(options.message, '以后关闭主窗口时如何处理？');
      return { response: responses.shift() };
    };
    window.close();
    await delay(100);
    assert.equal((await run('window.aluneTray.getPreferences()')).closeMode, 'ask');
    window.close();
    await delay(100);
    assert.equal((await run('window.aluneTray.getPreferences()')).closeMode, 'hide');
    assert.equal(responses.length, 0);
  } finally {
    dialog.showMessageBox = prompt;
  }
  assert.ok(!window.isDestroyed() && !window.isVisible(), 'close preserved hidden workspace');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('switch', '-qc', 'tray-external');
  await waitBranch('tray-external', 42000);
  branchItem('tray-external').click();
  await wait(contents, 'location.pathname === ' + JSON.stringify('/repositories/' + id));
  if (process.env.ALUNE_SMOKE_VISIBLE === '1') assert.ok(window.isVisible());
  git('switch', '-q', 'main');
  repositoryTray.refresh();
  await waitBranch('main', 15000);
  await run("window.aluneTray.setPreferences({closeMode:'ask'})");
  console.log(
    'Packaged tray tracked external checkout while hidden and selected the original tab.',
  );
};
