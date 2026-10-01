import assert from 'node:assert/strict';

// Exercise the real shared implementation via the same TSX demo documented on
// the website. Run with the desktop Electron harness after website:build/preview.
export async function runDialogChecks(page) {
  await page.goto(
    process.env.ALUNE_UI_PREVIEW_URL ??
      'http://127.0.0.1:4321/Alune/ui/preview/modal/?motion=reduced',
  );
  await page.waitForFunction(() => document.documentElement.dataset.previewReady === 'true');
  const open = () => page.click('text="打开弹窗"');
  const closed = () =>
    page.waitForFunction(() => document.activeElement.textContent === '打开弹窗');
  const ready = () => page.waitForFunction(() => !document.querySelector('button[aria-busy=true]'));
  await open();
  await page.waitForFunction(
    () => document.activeElement.getAttribute('aria-label') === '配置名称',
  );
  await page.press('input[aria-label="配置名称"]', 'Return');
  await closed();
  assert.equal(
    await page.evaluate(() => document.querySelector('main [role=status]').textContent),
    '操作已完成',
  );

  await page.click('input[type=radio][value="1"]');
  await page.click('button[aria-label="模拟异步失败"]');
  await open();
  await page.waitForFunction(() => document.activeElement.textContent === '保存配置');
  await page.fill('input[aria-label="配置名称"]', '保留的草稿');
  // Dispatch two clicks in one turn: a React state update alone cannot lock this.
  const calls = await page.evaluate(() => {
    const original = window.setTimeout;
    let count = 0;
    window.setTimeout = (fn, ms, ...args) => {
      if (ms === 600) count++;
      return original(fn, ms, ...args);
    };
    try {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent === '保存配置',
      );
      button.click();
      button.click();
      return count;
    } finally {
      window.setTimeout = original;
    }
  });
  assert.equal(calls, 1, 'same-turn repeated submission must be locked');
  await page.waitForFunction(() => document.body.innerText.includes('保存失败，输入已保留。'));
  await ready();
  assert.equal(
    await page.evaluate(() => document.querySelector('input[aria-label="配置名称"]').value),
    '保留的草稿',
  );
  await page.press('input[aria-label="配置名称"]', 'Escape');
  await closed();

  await page.click('input[type=radio][value="2"]');
  await open();
  await page.waitForFunction(() => document.activeElement.textContent === '取消');
  const blocked = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('button')].find((b) => b.textContent === '放弃更改').disabled,
    );
  assert.equal(await blocked(), true);
  await page.fill('input[placeholder="main"]', 'wrong');
  assert.equal(await blocked(), true);
  await page.fill('input[placeholder="main"]', 'main');
  assert.equal(await blocked(), true, 'typed confirmation alone is insufficient');
  await page.click('input[type=checkbox]');
  assert.equal(await blocked(), false);
  await page.press('input[placeholder="main"]', 'Return');
  assert.equal(
    await page.evaluate(() =>
      Boolean(document.querySelector('[role=alertdialog] input[placeholder="main"]')),
    ),
    true,
  );
  await page.click('text="取消"');
  await closed();

  await page.click('input[type=radio][value="0"]');
  await open();
  await page.waitForFunction(
    () => document.activeElement.getAttribute('aria-label') === '配置名称',
  );
  assert.equal(
    await page.evaluate(() =>
      document.querySelector('input[aria-label="配置名称"]').closest('[role]').getAttribute('role'),
    ),
    'dialog',
  );
  await page.press('input[aria-label="配置名称"]', 'Escape');
  await closed();
  return {
    levels: 'L0/L1/L2',
    focus: 'field/ok/cancel and restored',
    keyboard: 'Enter/Escape',
    gates: 'typed+checkbox',
    async: 'success/failure with preserved input',
    duplicate: 'same-turn locked',
    role: 'reset after L2',
  };
}
