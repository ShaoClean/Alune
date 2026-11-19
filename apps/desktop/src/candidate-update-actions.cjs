// Only the --smoke-test adapter is used: no download host or real installer.
const assert = require('node:assert/strict');
module.exports = async ({ window, origin, updates, wait, measure }) => {
  assert.ok(process.argv.includes('--smoke-test'), 'never run against a real updater');
  assert.equal(updates.adapter.installs, 0);
  const wc = window.webContents;
  const { textButton, click } = require('./candidate-ui-driver.cjs')(wc, wait);
  const button = (label) => textButton(label, '[data-testid="update-panel"] button');
  await window.loadURL(origin + '/settings/updates');
  await wait(wc, 'document.querySelector("[data-testid=update-panel]")');
  await measure(['UI-047'], 'mounted settings update check exposes the safe adapter version and sanitized release notes; no installer invoked', async () => {
    await click(button('检查更新'));
    await wait(wc, 'document.querySelector("[data-testid=update-panel]")?.textContent.includes("发现新版本")');
    assert.equal(updates.getState().status, 'available');
    assert.ok(await wc.executeJavaScript('Boolean(document.querySelector(".release-notes table")) && !document.querySelector(".release-notes script, .release-notes iframe") && ![...document.querySelectorAll(".release-notes a")].some(a=>a.getAttribute("href")?.startsWith("javascript:"))'));
    assert.equal(updates.adapter.installs, 0);
  });
  await measure(['UI-047'], 'mounted update download failure is displayed; retry starts download and explicit cancel aborts it without invoking install', async () => {
    const download = updates.adapter.download;
    updates.adapter.download = async () => { throw new Error('isolated acceptance download failure'); };
    try {
      await click(button('下载更新'));
      await wait(wc, 'document.querySelector("[data-testid=update-panel]")?.textContent.includes("更新未完成")');
      assert.equal(updates.getState().error.action, 'download');
      assert.equal(updates.getState().error.message, 'isolated acceptance download failure');
      await updates.active?.promise;
    } finally { updates.adapter.download = download; }
    await click(button('重新下载'));
    await wait(wc, button('取消下载'));
    assert.equal(updates.getState().status, 'downloading');
    await click(button('取消下载'));
    await wait(wc, button('下载更新'));
    await updates.active?.promise;
    assert.equal(updates.getState().status, 'available');
    assert.equal(updates.downloaded, null);
    assert.equal(updates.adapter.installs, 0);
  });
  // Installation closes the real isolated backend, so this must be the final
  // native write-phase action. The adapter only increments a counter.
  await measure(['UI-047'], 'mounted update re-download reaches verified state; restart-install closes the isolated backend and invokes only the smoke installer once (not native installation evidence)', async () => {
    await click(button('下载更新'));
    await wait(wc, button('重启安装'));
    assert.equal(updates.getState().status, 'downloaded');
    assert.equal(updates.adapter.installs, 0);
    await click(button('重启安装'));
    await wait(wc, 'document.querySelector("[data-testid=update-panel]")?.textContent.includes("正在准备更新并重启安装")');
    await updates.active?.promise;
    assert.equal(updates.getState().status, 'installing');
    assert.equal(updates.adapter.installs, 1);
  });
};
