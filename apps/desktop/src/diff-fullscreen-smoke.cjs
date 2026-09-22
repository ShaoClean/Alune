const assert = require('node:assert/strict');

// Exercise the actual mounted renderer in both changes and history workspaces.
module.exports = async ({ window, scroll = false }) => {
  const execute = (script) => window.webContents.executeJavaScript(script);
  const wait = (condition) =>
    execute(`new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (${condition}) return resolve(true);
      if (Date.now() - start > 5000) return reject(new Error(${JSON.stringify(condition)}));
      setTimeout(check, 20);
    }; check();
  })`);
  const setMode = (split) =>
    execute(
      `Array.from(document.querySelectorAll('.diff-view-switch .ant-segmented-item')).find(item => item.textContent.trim() === '${split ? '分栏视图' : '统一视图'}').click()`,
    );
  const click = (label) => execute(`document.querySelector('[aria-label="${label}"]').click()`);
  const bounds = window.getBounds();
  const nativeFullscreen = window.isFullScreen();
  const saved = await execute('window.aluneWorkspace.load()');
  const split = await execute("Boolean(document.querySelector('.diff-split-view'))");
  const position = await execute(`(() => {
    window.__fullscreenBody = document.querySelector('.diff-shell__body');
    window.__fullscreenBody.scrollTop = ${scroll ? 1200 : 0};
    document.querySelector('[aria-label="全屏查看差异"]').focus();
    return window.__fullscreenBody.scrollTop;
  })()`);
  if (scroll) assert.ok(position > 0, 'the fixture must scroll before expanding');
  await click('全屏查看差异');
  await wait("document.querySelector('.diff-shell--fullscreen')");
  assert.deepEqual(
    await execute(`(() => {
    const shell = document.querySelector('.diff-shell');
    const rect = shell.getBoundingClientRect();
    return {
      fillsWindow: rect.x === 0 && rect.y === 0 && rect.width === innerWidth && rect.height === innerHeight,
      sameBody: shell.querySelector('.diff-shell__body') === window.__fullscreenBody,
      modal: shell.getAttribute('aria-modal'),
      native: document.fullscreenElement !== null,
      focused: document.activeElement.getAttribute('aria-label'),
    };
  })()`),
    { fillsWindow: true, sameBody: true, modal: 'true', native: false, focused: '退出全屏查看' },
  );
  if (process.env.ALUNE_FULLSCREEN_SCREENSHOT)
    require('node:fs').writeFileSync(
      process.env.ALUNE_FULLSCREEN_SCREENSHOT,
      (await window.webContents.capturePage()).toPNG(),
    );
  assert.deepEqual(window.getBounds(), bounds);
  assert.equal(window.isFullScreen(), nativeFullscreen);
  await execute(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    window.__fullscreenBody.scrollTop = 2000;
    document.querySelector('.diff-shell').dispatchEvent(new Event('cancel', { cancelable: true }));`);
  await wait("!document.querySelector('.diff-shell--fullscreen')");
  assert.equal(await execute('window.__fullscreenBody.scrollTop'), position);
  assert.equal(await execute("document.activeElement.getAttribute('aria-label')"), '全屏查看差异');
  assert.equal(await execute("document.querySelector('.app-tabbar').inert"), false);
  // Rapid toggles must neither leave a backdrop nor lose the content node.
  for (let index = 0; index < 4; index++) {
    await click('全屏查看差异');
    await wait("document.querySelector('.diff-shell--fullscreen')");
    await click('退出全屏查看');
    await wait("!document.querySelector('.diff-shell--fullscreen')");
  }
  await click('全屏查看差异');
  await wait("document.querySelector('.diff-shell--fullscreen')");
  await setMode(!split);
  await wait(`Boolean(document.querySelector('.diff-split-view')) === ${!split}`);
  await wait('window.__fullscreenBody.scrollTop === 0');
  await click('退出全屏查看');
  await wait("!document.querySelector('.diff-shell--fullscreen')");
  assert.equal(await execute('window.__fullscreenBody.scrollTop'), 0);
  assert.equal(
    await execute("window.__fullscreenBody === document.querySelector('.diff-shell__body')"),
    true,
  );
  assert.deepEqual(window.getBounds(), bounds);
  assert.equal(
    await execute('window.aluneWorkspace.load()'),
    saved,
    'fullscreen never persists layout',
  );
  // Restore the original mode for the caller's remaining smoke checks.
  await setMode(split);
  await execute('delete window.__fullscreenBody;');
  await wait(`Boolean(document.querySelector('.diff-split-view')) === ${split}`);
  console.log(
    'Diff window fullscreen passed: bounds, content identity, scroll, focus, Esc, rapid toggles, mode and preferences.',
  );
};
