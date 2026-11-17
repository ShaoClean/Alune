import assert from 'node:assert/strict';
export async function runLayoutNavigationChecks(page, base) {
  await page.goto(base + '/tests/p0-layout-navigation-fixture.html');
  await page.waitForSelector('#open-layout');
  const records = [];
  const counts = () => page.evaluate(() => [...(window.__aluneAudit?.counts ?? [])]);
  const layout = () => page.evaluate(() => JSON.parse(document.querySelector('#layout-state').textContent));
  const nav = () => page.evaluate(() => JSON.parse(document.querySelector('#navigation-state').textContent));
  async function measure(name, work) {
    const before = new Map(await counts());
    const facts = await work();
    const executed = (await counts()).filter(([id, n]) => n > (before.get(id) ?? 0)).map(([id]) => id);
    records.push({ name, facts, executed });
  }
  const initial = await layout();
  await page.click('#open-layout'); await page.waitForSelector('.ant-modal[role="dialog"]');
  await measure('layout panel visibility toggles disable and restore the corresponding width controls', async () => {
    for (const [label, field, range] of [['显示左侧工作区', 'sidebarCollapsed', '工作区宽度'], ['显示右侧面板', 'changesCollapsed', '右侧面板宽度']]) {
      const selector = `.ant-modal [aria-label="${label}"]`;
      await page.click(selector); assert.equal((await layout())[field], true);
      assert.equal(await page.evaluate(selector => document.querySelector(selector).disabled, `.ant-modal input[aria-label="${range}"]`), true);
      await page.click(selector); assert.equal((await layout())[field], false);
    }
    return { sidebarCollapsed: false, changesCollapsed: false };
  });
  await measure('layout native range keyboard input changes exact persisted widths', async () => {
    for (const [label, field] of [['工作区宽度', 'sidebarWidth'], ['右侧面板宽度', 'changesWidth']]) {
      const before = (await layout())[field];
      await page.press(`.ant-modal input[aria-label="${label}"]`, 'ArrowRight');
      assert.equal((await layout())[field], before + 1);
    }
    return { sidebarWidth: (await layout()).sidebarWidth, changesWidth: (await layout()).changesWidth };
  });
  await measure('layout segmented Diff selection and reset preserve exact defaults', async () => {
    await page.click('.ant-modal .ant-segmented-item:has-text("分栏")');
    assert.equal((await layout()).diffMode, 'split');
    await page.click('.ant-modal button:has-text("恢复默认")');
    assert.deepEqual(await layout(), initial);
    return { diffMode: initial.diffMode, restored: true };
  });
  await measure('layout completion and Escape both dismiss the real modal', async () => {
    await page.click('.ant-modal button:has-text("完成")'); await page.waitForSelector('.ant-modal[role="dialog"]', { state: 'hidden' });
    await page.click('#open-layout'); await page.waitForSelector('.ant-modal[role="dialog"]');
    await page.press('.ant-modal[role="dialog"]', 'Escape'); await page.waitForSelector('.ant-modal[role="dialog"]', { state: 'hidden' });
    return { completionClosed: true, escapeClosed: true };
  });
  await measure('Diff navigation advances, wraps, excludes text entry and follows manual scroll', async () => {
    await page.click('#next'); assert.equal((await nav()).index, 0);
    await page.click('#next'); assert.equal((await nav()).index, 1);
    await page.press('#diff-body', 'F7'); assert.equal((await nav()).index, 2);
    await page.press('#diff-body', 'F7'); assert.equal((await nav()).index, 0); assert.equal((await nav()).notice, '已回到第一处改动');
    await page.focus('#diff-body input');
    await page.waitForFunction(() => document.querySelector('#diff-body').scrollTop === 0 && JSON.parse(document.querySelector('#navigation-state').textContent).index === -1);
    const inputIndex = (await nav()).index;
    await page.press('#diff-body input', 'F7'); assert.equal((await nav()).index, inputIndex);
    await page.click('#next'); assert.equal((await nav()).index, 0);
    await page.click('#previous'); assert.equal((await nav()).index, 2); assert.equal((await nav()).notice, '已回到最后一处改动');
    await page.evaluate(() => { const body = document.querySelector('#diff-body'); body.scrollTop = 300; body.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => JSON.parse(document.querySelector('#navigation-state').textContent).index === 1);
    const value = await nav(); assert.equal(value.total, 3); return value;
  });
  await measure('Diff navigation unmount clears pending listeners and remount starts at the new viewport', async () => {
    assert.equal(await page.evaluate(() => window.__p0ScrollListenerCount()), 1);
    await page.click('#toggle-navigation'); await page.waitForSelector('#diff-body', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__p0ScrollListenerCount()), 0);
    await page.click('#toggle-navigation'); await page.waitForSelector('#diff-body');
    assert.equal(await page.evaluate(() => window.__p0ScrollListenerCount()), 1);
    assert.equal((await nav()).index, -1); return { index: -1, listenersAfterUnmount: 0, listenersAfterRemount: 1 };
  });
  await measure('Diff fullscreen retains actual scroll position and returns focus after native Escape', async () => {
    await page.evaluate(() => { document.querySelector('#fullscreen-body').scrollTop = 30; });
    await page.click('#fullscreen-toggle'); await page.waitForSelector('#fullscreen-shell:modal');
    assert.equal(await page.evaluate(() => document.querySelector('#fullscreen-body').scrollTop), 30);
    await page.press('#fullscreen-shell', 'Escape'); await page.waitForFunction(() => !document.querySelector('#fullscreen-shell').matches(':modal'));
    assert.equal(await page.evaluate(() => document.querySelector('#fullscreen-body').scrollTop), 30);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fullscreen-toggle');
    return { scrollTop: 30, returnFocus: 'fullscreen-toggle' };
  });
  await measure('Markdown external image is opt-in and a real decode error becomes an accessible fallback', async () => {
    assert.equal(await page.evaluate(() => document.querySelectorAll('.markdown-preview img').length), 0);
    await page.click('button:has-text("加载外部图片")');
    await page.waitForFunction(() => document.querySelector('.markdown-preview__image-fallback')?.textContent.includes('图片加载失败'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('.markdown-preview img').length), 0);
    return { failed: true, imagesBeforeOptIn: 0, failedImageNodes: 0 };
  });
  await measure('File context menu Tab restores trigger focus and resize dismisses its exact target', async () => {
    await page.press('#file-menu-target', 'Shift+F10'); await page.waitForSelector('.workspace-file-menu [role="menu"]');
    await page.press('.workspace-file-menu [role="menu"]', 'Tab'); await page.waitForSelector('.workspace-file-menu [role="menu"]', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'file-menu-target');
    await page.press('#file-menu-target', 'Shift+F10'); await page.waitForSelector('.workspace-file-menu [role="menu"]');
    await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await page.waitForSelector('.workspace-file-menu [role="menu"]', { state: 'hidden' });
    return { tabClosed: true, restoredFocus: true, resizeClosed: true };
  });
  await measure('Diff highlighter loads actual syntax tokens and refuses content beyond the exact size limit', async () => {
    await page.waitForFunction(() => JSON.parse(document.querySelector('#highlight-state').textContent).tokens > 0);
    const before = await page.evaluate(() => JSON.parse(document.querySelector('#highlight-state').textContent));
    assert.equal(before.limit, 262144); assert.equal(before.failed, false); assert.equal(before.tooLarge, false);
    assert.equal(await page.evaluate(() => !!document.querySelector('#highlight-tokens .token.keyword')), true);
    await page.click('#toggle-highlight-size');
    const boundary = await page.evaluate(() => JSON.parse(document.querySelector('#highlight-state').textContent));
    assert.equal(boundary.tooLarge, false); assert(boundary.tokens > 0);
    await page.click('#toggle-highlight-size');
    const large = await page.evaluate(() => JSON.parse(document.querySelector('#highlight-state').textContent));
    assert.equal(large.tokens, 0); assert.equal(large.tooLarge, true);
    await page.click('#toggle-highlight-size'); await page.waitForFunction(() => JSON.parse(document.querySelector('#highlight-state').textContent).tokens > 0);
    return { limit: 262144, keyword: true, oversizedTokens: 0 };
  });
  return { records, limitations: 'Synthetic standalone component fixture. Native browser pointer/keyboard and actual rendered state assertions; manually dispatched scroll tests listener state only. No backend, installed desktop or full feature acceptance.' };
}
