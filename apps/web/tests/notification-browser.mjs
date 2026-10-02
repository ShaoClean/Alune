// The same acceptance scenarios run in Ego Lite and an isolated Electron renderer.
import assert from 'node:assert/strict';

export async function runNotificationChecks(page, resize) {
  await page.goto('http://127.0.0.1:5188/tests/feedback-fixture.html');
  await page.waitForSelector('.status-button--feedback');
  const inbox = '.feedback-inbox:popover-open';
  const trigger = '.status-button--feedback';
  const read = () =>
    page.evaluate(() => ({
      count: document.querySelector('.status-button--feedback').getAttribute('aria-label'),
      groups: [...document.querySelectorAll('.feedback-group-label')].map(
        (node) => node.textContent,
      ),
      items: document.querySelectorAll('.feedback-inbox .fb-item').length,
      unread: document.querySelectorAll('.feedback-inbox .fb-item.is-new').length,
      times: document.querySelectorAll('.feedback-inbox time[datetime]').length,
      entries: document.querySelectorAll('.status-button--feedback').length,
      floating: document.querySelectorAll(
        '.feedback-tray,.feedback-tray-button,.status-notifications',
      ).length,
    }));
  const closed = () =>
    page.waitForFunction(() => !document.querySelector('.feedback-inbox:popover-open'));
  const close = async () => {
    await page.press(inbox, 'Escape');
    await closed();
    assert.equal(
      await page.evaluate(() => document.activeElement.matches('.status-button--feedback')),
      true,
    );
  };
  await page.press(trigger, 'Enter');
  await page.waitForSelector(inbox);
  assert.equal(
    await page.evaluate(() => document.querySelector('.feedback-inbox-empty').textContent),
    '暂无通知与提示',
  );
  assert.equal((await read()).count, '通知与提示（0 条，0 条未读）');
  await close();
  await page.click('#notifications');
  await page.waitForFunction(
    () => document.querySelectorAll('.feedback-inbox .fb-item').length === 4,
  );
  assert.equal(
    await page.evaluate(() => Boolean(document.querySelector('.feedback-dialog:modal'))),
    false,
  );
  await page.click(trigger);
  await page.waitForSelector(inbox);
  assert.deepEqual(await read(), {
    count: '通知与提示（4 条，4 条未读）',
    groups: ['Alune', '设置', '本机仓库', 'SSH 仓库'],
    items: 4,
    unread: 4,
    times: 4,
    entries: 1,
    floating: 0,
  });
  await page.click('.feedback-group[aria-label="设置"] .fb-item-open');
  await page.waitForSelector('.feedback-dialog:modal');
  await closed();
  assert.equal(
    await page.evaluate(() => document.querySelector('#feedback-title').textContent),
    '无法保存外观与工作区设置',
  );
  await page.press('button[aria-label="关闭提示"]', 'Escape');
  await page.waitForFunction(() => !document.querySelector('.feedback-dialog:modal'));
  assert.equal(
    await page.evaluate(() => document.activeElement.matches('.status-button--feedback')),
    true,
  );
  assert.equal((await read()).unread, 3);
  await page.click(trigger);
  await page.waitForSelector(inbox);
  await page.click('.feedback-group[aria-label="本机仓库"] .fb-item-actions button');
  await page.waitForFunction(
    () => document.querySelectorAll('.feedback-inbox .fb-item').length === 3,
  );
  await page.click('.feedback-group[aria-label="SSH 仓库"] .fb-item-actions button');
  await page.waitForFunction(
    () => document.querySelectorAll('.feedback-inbox .fb-item').length === 2,
  );
  assert.equal((await read()).count, '通知与提示（2 条，1 条未读）');
  await page.click('.feedback-group[aria-label="Alune"] .fb-item-actions button');
  await closed();
  assert.equal(
    await page.evaluate(() => document.querySelector('#updates-opened').textContent),
    '1',
  );
  assert.equal((await read()).unread, 0);
  await page.click('#notice-revision');
  await page.waitForFunction(() => document.querySelectorAll('.fb-item.is-new').length === 1);
  assert.equal((await read()).items, 2);
  await page.click('#switch');
  assert.equal((await read()).items, 2);

  // Only the inbox closes on Escape; the native fullscreen Diff stays open.
  await page.click('button[aria-label="全屏查看差异"]');
  await page.waitForSelector('.diff-shell:modal .status-button--feedback');
  assert.equal((await read()).entries, 1);
  await page.press(trigger, 'Enter');
  await page.waitForSelector('.diff-shell:modal .feedback-inbox:popover-open');
  await close();
  assert.equal(
    await page.evaluate(() => Boolean(document.querySelector('.diff-shell:modal'))),
    true,
  );
  await page.click(trigger);
  await page.waitForSelector(inbox);
  await page.click('.feedback-group[aria-label="Alune"] .fb-item-open');
  await page.waitForSelector('.feedback-dialog:modal');
  await page.press('button[aria-label="关闭提示"]', 'Escape');
  await page.waitForFunction(() => !document.querySelector('.feedback-dialog:modal'));
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.matches('.diff-shell:modal .status-button--feedback'),
    ),
    true,
  );
  await page.click(trigger);
  await page.waitForSelector(inbox);
  await page.click('.feedback-group[aria-label="Alune"] .fb-item-actions button');
  await page.waitForFunction(() => !document.querySelector('.diff-shell:modal'));
  await page.waitForSelector(
    '.status-bar:not(.feedback-fullscreen-status) .status-button--feedback',
  );
  await closed();
  assert.equal(
    await page.evaluate(() => document.querySelector('#updates-opened').textContent),
    '2',
  );

  if (resize) {
    await resize(360, 640);
    await page.waitForFunction(() => innerWidth === 360);
    await page.click(trigger);
    await page.waitForSelector(inbox);
    await page.waitForFunction(() =>
      document
        .querySelector('.feedback-inbox')
        .getAnimations()
        .every((animation) => animation.playState === 'finished'),
    );
    const bounds = await page.evaluate(() => ({
      panel: document.querySelector('.feedback-inbox').getBoundingClientRect().toJSON(),
      trigger: document.querySelector('.status-button--feedback').getBoundingClientRect().toJSON(),
      width: document.documentElement.clientWidth,
      height: innerHeight,
    }));
    assert.ok(bounds.panel.left >= 0 && bounds.panel.right <= bounds.width);
    assert.ok(bounds.panel.top >= 0 && bounds.panel.bottom <= bounds.trigger.top);
    assert.ok(
      bounds.trigger.width > 0 &&
        bounds.trigger.right <= bounds.width &&
        bounds.trigger.bottom <= bounds.height,
    );
    await close();
    await resize(1100, 800);
  }
  await page.click('#clear-notifications');
  await page.waitForFunction(() => !document.querySelector('.feedback-inbox .fb-item'));
  assert.equal((await read()).count, '通知与提示（0 条，0 条未读）');
  await page.click(trigger);
  await page.waitForSelector(inbox);
  await page.click('.feedback-inbox-more');
  await closed();
  assert.equal(
    await page.evaluate(() => document.querySelector('#updates-opened').textContent),
    '3',
  );
  await page.click(trigger);
  await page.waitForSelector(inbox);
  await page.click('#workspace');
  await closed();
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelectorAll(
          '.feedback-inbox:popover-open,.feedback-dialog:modal,.diff-shell:modal',
        ).length,
    ),
    0,
  );
  return {
    uniqueEntry: true,
    empty: true,
    groups: 4,
    retry: 'local and SSH',
    updates: 3,
    focus: 'restored',
    fullscreen: 'reachable',
    narrow: Boolean(resize),
    revision: 'deduplicated',
    cleanup: true,
  };
}
