import assert from 'node:assert/strict';

export async function runSettingsTerminalPrChecks(page, base = 'http://127.0.0.1:5173') {
  const text = selector => page.evaluate(selector => document.querySelector(selector)?.textContent ?? '', selector);
  await page.goto(`${base}/tests/settings-terminal-pr-fixture.html`);
  await page.waitForSelector('nav[aria-label="设置分类"]');
  await page.click('text="外观"');
  await page.click('#fail-settings');
  await page.click('text="AI 服务商"');
  await page.click('#reload-settings');
  await page.waitForSelector('dialog:modal');
  assert.match(await text('dialog:modal'), /AI 设置读取失败/);
  await page.click('button[aria-label="关闭提示"]');
  await page.goto(`${base}/tests/settings-terminal-pr-fixture.html?terminal=1`);
  await page.waitForSelector('button[aria-label="全部终端会话"]');
  await page.click('button[aria-label="全部终端会话"]');
  await page.waitForSelector('.ant-modal[role="dialog"]');
  assert.match(await text('.ant-modal[role="dialog"]'), /验收仓库[\s\S]*启动失败/);
  await page.press('.ant-modal[role="dialog"]', 'Escape');
  await page.waitForSelector('.ant-modal[role="dialog"]', { state: 'hidden' });
  await page.waitForSelector('button[aria-label="全部终端会话"]');
  await page.click('button[aria-label="全部终端会话"]');
  await page.waitForSelector('.ant-modal[role="dialog"]');
  assert.match(await text('.ant-modal[role="dialog"]'), /验收仓库[\s\S]*启动失败/);
  await page.press('.ant-modal[role="dialog"]', 'Escape');
  await page.waitForSelector('.ant-modal[role="dialog"]', { state: 'hidden' });
  await page.fill('input[placeholder="搜索标题、编号、作者或分支"]', 'Fixture');
  await page.click('text="刷新"');
  await page.waitForFunction(() => document.body.textContent.includes('Fixture PR'));
  return { settings: 'read failure dialog is shown and dismissible',
    terminal: 'session picker preserves the failed session when closed and reopened',
    pullRequest: 'search and refresh retain the matching fixture PR' };
}
