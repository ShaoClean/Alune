const assert = require('node:assert/strict');

// Exercise the shared shell in the real renderer, with a real local repository.
module.exports = async ({ window, origin, repositoryId }) => {
  const execute = async (script) => {
    try {
      return await window.webContents.executeJavaScript(script);
    } catch (error) {
      const page = await window.webContents.executeJavaScript('document.body.innerText + "\\nFocus: " + JSON.stringify({active: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label"), documentFocused: document.hasFocus()})');
      throw new Error(`Settings shell failed: ${script}\n${page}`, { cause: error });
    }
  };
  const wait = (condition) =>
    execute(`new Promise((resolve, reject) => {
    const started = Date.now(); const poll = () => {
      if (${condition}) return resolve(true);
      if (Date.now() - started > 8000) return reject(Error(${JSON.stringify(condition)} + ': ' + location.pathname));
      setTimeout(poll, 20);
    }; poll();
  })`);
  const shortcut = (key, shiftKey = false) =>
    execute(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, ctrlKey: true, shiftKey: ${shiftKey} }))`,
    );
  const click = (selector) =>
    execute(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => node.getClientRects().length && !node.closest('[inert]')).click()`,
    );
  const backToWorkspace = async () => {
    await click('.settings-back');
    // The router updates the URL before React restores the workspace DOM and scroll.
    await wait(
      `!location.pathname.startsWith('/settings') && !document.querySelector('.settings-main') && document.querySelector('.app-main > .app-content:not([hidden])')?.getClientRects().length > 0`,
    );
  };
  const fill = (selector, value) =>
    execute(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const category = async (name) => {
    await execute(
      `Array.from(document.querySelectorAll('.settings-category-nav button')).find(button => button.textContent === ${JSON.stringify(name)}).click()`,
    );
    await wait(
      `document.querySelector('.app-tabbar__title strong')?.textContent === ${JSON.stringify(name)}`,
    );
  };
  const menu = async (name) => {
    await click('.repository-switcher');
    await wait("document.querySelector('.repository-switcher-panel')?.getClientRects().length > 0");
    await execute(
      `Array.from(document.querySelectorAll('.repository-switcher-panel button')).find(button => button.getAttribute('aria-label') === ${JSON.stringify(name)}).click()`,
    );
  };
  const dimensions = () =>
    execute(`['.app-sidebar', '.app-tabbar', '.status-bar'].map(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    const style = getComputedStyle(document.querySelector(selector));
    return [rect.x, rect.y, rect.width, rect.height, style.backgroundColor, style.borderBottomColor];
  })`);
  const originalSize = window.getSize();
  const originalMinimumSize = window.getMinimumSize();
  const saved = await execute('window.aluneWorkspace.load()');
  try {
    window.setContentSize(1440, 900);
    await window.loadURL(`${origin}/repositories/${repositoryId}`);
    await wait('document.querySelector(\'[aria-label="提交摘要"]\') !== null');
    await execute(`document.querySelector('.app-tabbar [aria-label="显示左侧工作区"]')?.click()`);
    await fill('[aria-label="提交摘要"]', 'settings draft retained');
    await fill('[aria-label="查找仓库"]', 'local');
    await execute(
      `document.querySelector('[aria-label="提交摘要"]').focus(); window.settingsWorkspaceNode = document.querySelector('.workspace-body'); window.settingsSidebarNode = document.querySelector('.sidebar-workspace');`,
    );
    await wait("document.activeElement?.getAttribute('aria-label') === '提交摘要'");
    await execute(`document.querySelector('.app-sidebar__content').scrollTop = 120`);
    const sidebarScroll = await execute(
      "document.querySelector('.app-sidebar__content').scrollTop",
    );
    const before = await dimensions();
    await shortcut(',');
    await wait("document.querySelector('.settings-main [aria-label=\"API 地址\"]')");
    const { createAiSecretStorage } = require('./ai-secret-storage.cjs');
    if (!createAiSecretStorage(require('electron').safeStorage).available) {
      await wait("document.querySelector('.feedback-dialog[open]')?.textContent.includes('系统密钥存储不可用')");
      await click('.feedback-dialog [aria-label="关闭提示"]');
      await wait("!document.querySelector('.feedback-dialog[open]')");
    }
    await wait(
      "document.querySelector('.settings-main') && document.activeElement?.getAttribute('aria-label') === '返回工作区'",
    );
    assert.deepEqual(
      await dimensions(),
      before,
      'same sidebar, tab bar and status bar geometry and tokens',
    );
    assert.equal(
      await execute(
        "document.querySelector('.app-tabbar .repository-tabs, .app-tabbar [aria-controls=workspace-list]') === null",
      ),
      true,
    );
    assert.equal(await execute("document.querySelector('.repository-toolbar-row')?.hidden"), true);
    assert.equal(await execute("document.querySelector('.app-main > [hidden]')?.inert"), true);
    await shortcut('b');
    await wait("document.activeElement?.matches('.app-tabbar .settings-back')");
    await shortcut('b');
    await wait("document.activeElement?.matches('.app-sidebar .settings-back')");
    await category('提交生成');
    await wait("document.querySelector('.feedback-dialog[open]')?.textContent.includes('仅已暂存改动')");
    await click('.feedback-dialog [aria-label="关闭提示"]');
    await wait("!document.querySelector('.feedback-dialog[open]')");
    assert.ok(
      await execute(
        'document.querySelector(\'textarea[aria-label="补充提示词"]\').getBoundingClientRect().height > 60',
      ),
      'multiline prompt keeps its four rows',
    );
    await shortcut(',');
    assert.equal(await execute('location.pathname'), '/settings/commit');
    await menu('设置');
    assert.equal(await execute('location.pathname'), '/settings/commit');
    const layout = JSON.parse(await execute('window.aluneWorkspace.load()')).state.layout;
    await shortcut('b', true);
    assert.deepEqual(
      JSON.parse(await execute('window.aluneWorkspace.load()')).state.layout,
      layout,
    );
    await shortcut('b');
    await wait("document.querySelector('.app-shell--collapsed') !== null");
    await backToWorkspace();
    assert.equal(await execute('location.pathname'), `/repositories/${repositoryId}`);
    assert.equal(
      await execute('document.querySelector(\'[aria-label="提交摘要"]\').value'),
      'settings draft retained',
    );
    await wait("document.activeElement?.getAttribute('aria-label') === '提交摘要'");
    assert.equal(
      await execute(
        "window.settingsWorkspaceNode === document.querySelector('.workspace-body') && window.settingsSidebarNode === document.querySelector('.sidebar-workspace')",
      ),
      true,
    );
    assert.equal(
      await execute('document.querySelector(\'[aria-label="查找仓库"]\').value'),
      'local',
    );
    assert.equal(
      await execute("document.querySelector('.app-sidebar__content:not([hidden])').scrollTop"),
      sidebarScroll,
    );
    await shortcut(',');
    await wait("document.querySelector('.app-tabbar .settings-back') !== null");
    await shortcut('b');
    await wait("!document.querySelector('.app-shell--collapsed')");
    // A nonzero scroll offset must survive even when focus returns above the viewport.
    await backToWorkspace();
    window.setMinimumSize(0, 0);
    window.setContentSize(1440, 240);
    await wait('innerHeight === 240');
    await execute(`document.querySelector('.sidebar-nav-item--active').focus();
      new Promise(resolve => {
        const sidebar = document.querySelector('.app-sidebar__content');
        sidebar.addEventListener('scroll', () => resolve(true), { once: true });
        sidebar.scrollTop = 120;
      })`);
    const nonzeroScroll = await execute(
      "document.querySelector('.app-sidebar__content').scrollTop",
    );
    assert.ok(nonzeroScroll > 0, 'exercise a genuinely scrolled sidebar');
    await shortcut(',');
    await wait("document.querySelector('.settings-main') !== null");
    await backToWorkspace();
    assert.equal(
      await execute("document.querySelector('.app-sidebar__content').scrollTop"),
      nonzeroScroll,
    );
    window.setContentSize(1440, 900);
    window.setMinimumSize(...originalMinimumSize);
    await shortcut(',');
    await wait("document.querySelector('.settings-main') !== null");
    for (const key of ['Home', 'End']) {
      await execute(
        `document.querySelector('[aria-label="调整设置分类宽度"]').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true }))`,
      );
      await wait(
        `document.querySelector('[aria-label="调整设置分类宽度"]').getAttribute('aria-valuenow') === '${key === 'Home' ? 184 : 320}'`,
      );
    }
    // Resizing is CSS-only: unsaved provider values and input identity survive every threshold.
    await wait('document.querySelector(\'[aria-label="API 地址"]\') !== null');
    await fill('[aria-label="API 地址"]', 'https://draft.example.invalid/v1');
    await execute(
      `window.settingsProviderInput = document.querySelector('[aria-label="API 地址"]')`,
    );
    for (const [width, expected] of [
      [1440, '210px'],
      [1100, '178px'],
    ]) {
      window.setContentSize(width, 900);
      await wait(
        `innerWidth === ${width} && getComputedStyle(document.querySelector('.provider-settings')).gridTemplateColumns.startsWith('${expected}')`,
      );
    }
    window.setContentSize(560, 900);
    await wait(
      "innerWidth === 560 && getComputedStyle(document.querySelector('.provider-detail')).display === 'none'",
    );
    await click('.provider-list__item[aria-current]');
    await wait("document.querySelector('.provider-detail').getClientRects().length > 0");
    assert.equal(
      await execute(
        "window.settingsProviderInput === document.querySelector('[aria-label=\"API 地址\"]') && window.settingsProviderInput.value === 'https://draft.example.invalid/v1'",
      ),
      true,
    );
    await click('.provider-mobile-back');
    await wait("getComputedStyle(document.querySelector('.provider-detail')).display === 'none'");
    // Drawer selection restores focus to the top-bar toggle, including at the minimum width.
    for (const width of [899, 741, 739, 320]) {
      window.setContentSize(width, 800);
      await wait(`innerWidth === ${width}`);
      await click('.app-tabbar [aria-controls="workspace-sidebar"]');
      await wait("document.querySelector('.app-shell--mobile-open') !== null");
      await category('外观');
      await wait(
        "!document.querySelector('.app-shell--mobile-open') && document.activeElement?.getAttribute('aria-controls') === 'workspace-sidebar'",
      );
      assert.equal(await execute('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(
        await execute(
          "document.querySelector('.app-tabbar .settings-back').getClientRects().length > 0",
        ),
        true,
      );
    }
    window.setContentSize(1440, 900);
    await wait("innerWidth === 1440 && !document.querySelector('.app-shell--mobile-open')");
    await category('网络代理');
    await wait('document.querySelector(\'[aria-label="代理服务器地址"]\') !== null');
    if (!createAiSecretStorage(require('electron').safeStorage).available) {
      await wait("document.querySelector('.feedback-dialog[open]')?.textContent.includes('设备安全存储不可用')");
      await click('.feedback-dialog [aria-label="关闭提示"]');
      await wait("!document.querySelector('.feedback-dialog[open]')");
    }
    assert.equal(
      await execute("document.querySelector('.proxy-savebar').getBoundingClientRect().bottom"),
      await execute("document.querySelector('.status-bar').getBoundingClientRect().top"),
    );
    await fill('[aria-label="代理服务器地址"]', 'draft.example.invalid');
    await wait("document.querySelector('.feedback-dialog[open]')?.textContent.includes('有未保存修改')");
    await click('.feedback-dialog [aria-label="关闭提示"]');
    await wait("!document.querySelector('.feedback-dialog[open]')");
    await menu('浏览全部仓库');
    await wait("document.querySelector('.a-dlg-title')?.textContent === '保存网络代理修改？'");
    assert.equal(await execute('location.pathname'), '/settings/proxy');
    await execute(
      `Array.from(document.querySelectorAll('.ant-modal button')).find(button => button.textContent === '继续编辑').click()`,
    );
    await wait(
      "!Array.from(document.querySelectorAll('.ant-modal-wrap')).some(node => node.getClientRects().length)",
    );
    assert.equal(
      await execute('document.querySelector(\'[aria-label="代理服务器地址"]\').value'),
      'draft.example.invalid',
    );
    await menu('浏览全部仓库');
    await wait("document.querySelector('.a-dlg-title')?.textContent === '保存网络代理修改？'");
    await execute(
      `Array.from(document.querySelectorAll('.ant-modal button')).find(button => button.textContent === '放弃修改并离开').click()`,
    );
    await wait("location.pathname === '/repositories'");
    for (const path of ['/connections', '/repositories']) {
      await window.loadURL(origin + path);
      await wait("document.querySelector('.app-shell') !== null");
      await shortcut(',');
      await wait("document.querySelector('.settings-main') !== null");
      await backToWorkspace();
      assert.equal(await execute('location.pathname'), path);
    }
    await window.loadURL(origin + '/settings/unknown');
    await wait("document.querySelector('.app-tabbar__title strong')?.textContent === 'AI 服务商'");
    console.log(
      'Desktop shared settings shell passed: geometry/tokens, retained workspace DOM/draft/search/focus, collapsed entry, resizing, right-panel guard, idempotent settings entry, provider draft at container thresholds, drawers down to 320px, proxy navigation confirmation, and return routes.',
    );
  } finally {
    await execute(`window.aluneWorkspace.save(${JSON.stringify(saved)})`);
    window.setMinimumSize(...originalMinimumSize);
    window.setSize(...originalSize);
    await window.loadURL(origin + '/repositories');
  }
};
