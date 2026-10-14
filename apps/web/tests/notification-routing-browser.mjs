// Notification routing, lifetime and read state; shared by browsers and the Electron renderer.
import assert from 'node:assert/strict';

export async function runNotificationRoutingChecks(
  page,
  url = 'http://127.0.0.1:5188/tests/notification-routing-fixture.html',
) {
  await page.goto(url);
  await page.waitForSelector('.status-button--feedback');
  const read = () =>
    page.evaluate(() => {
      const form = [...document.querySelectorAll('.a-dlg-shell')].find(
        (node) => node.getClientRects().length > 0,
      );
      return {
        badge: document.querySelector('.status-button--feedback').getAttribute('aria-label'),
        dialog: document.querySelector('.feedback-dialog:modal #feedback-title')?.textContent,
        form: form?.querySelector('.a-dlg-title')?.textContent,
      };
    });
  const badge = (entries, unread) => `通知与提示（${entries} 条，${unread} 条未读）`;
  const waitFor = (fn, arg) => page.waitForFunction(fn, arg);
  const formOpen = () =>
    waitFor(() =>
      [...document.querySelectorAll('.a-dlg-shell')].some(
        (node) => node.getClientRects().length > 0 && !node.closest('.alune-dlg-leave'),
      ),
    );
  const formClosed = () =>
    waitFor(
      () =>
        ![...document.querySelectorAll('.a-dlg-shell')].some(
          (node) => node.getClientRects().length > 0,
        ),
    );
  const dismissDialog = async (title) => {
    await waitFor(
      (title) =>
        document.querySelector('.feedback-dialog:modal #feedback-title')?.textContent === title,
      title,
    );
    await page.press('.feedback-dialog button[aria-label="关闭提示"]', 'Escape');
    await waitFor(() => !document.querySelector('.feedback-dialog:modal'));
  };

  // A background error never lands in an unrelated form; it waits for the form to close.
  await page.click('#open-form');
  await formOpen();
  await page.evaluate(() => window.routing.view.error('后台读取失败'));
  await waitFor(
    (text) =>
      document.querySelector('.status-button--feedback').getAttribute('aria-label') === text,
    badge(1, 1),
  );
  assert.deepEqual(await read(), { badge: badge(1, 1), dialog: undefined, form: '表单' });
  await page.click('.a-dlg-shell button[aria-label="关闭"]');
  await formClosed();
  await dismissDialog('后台读取失败');
  assert.equal((await read()).badge, badge(1, 0));

  // The form's own submission and controls keep their errors in place, out of the inbox.
  await page.click('#open-form');
  await formOpen();
  await page.click('.a-dlg-shell .ant-btn-primary');
  await waitFor(
    () => document.querySelector('.a-dlg-shell .a-dlg-title')?.textContent === '表单提交失败',
  );
  await page.click('.a-dlg-shell button[aria-label="关闭提示"]');
  await page.click('#form-inner');
  await waitFor(
    () => document.querySelector('.a-dlg-shell .a-dlg-title')?.textContent === '表单内操作失败',
  );
  assert.equal((await read()).badge, badge(1, 0));
  await page.click('.a-dlg-shell button[aria-label="关闭提示"]');

  // Closing the form while a result arrives: global, and never resurfaces in the form.
  await page.click('.a-dlg-shell button[aria-label="关闭"]');
  await page.evaluate(() => window.routing.view.error('关闭时到达的错误'));
  await formClosed();
  await dismissDialog('关闭时到达的错误');
  await page.click('#open-form');
  await formOpen();
  assert.equal((await read()).form, '表单');
  await page.click('.a-dlg-shell button[aria-label="关闭"]');
  await formClosed();
  assert.equal((await read()).badge, badge(2, 0));

  // One-off results outlive their view; a late result is recorded without interrupting.
  await page.click('#view-success');
  await dismissDialog('视图操作成功');
  await page.click('#toggle-view');
  assert.equal((await read()).badge, badge(3, 0));
  await page.evaluate(() => window.routing.view.error('切走后才返回的失败'));
  await waitFor(
    (text) =>
      document.querySelector('.status-button--feedback').getAttribute('aria-label') === text,
    badge(4, 1),
  );
  assert.equal((await read()).dialog, undefined);
  await page.click('#toggle-view');

  // Inbox: dismiss one result, mark everything read, clear read results.
  await page.click('.status-button--feedback');
  await page.waitForSelector('.feedback-inbox:popover-open');
  await page.click('.feedback-inbox button[aria-label="清除「视图操作成功」"]');
  await waitFor(() => document.querySelectorAll('.feedback-inbox .fb-item').length === 3);
  await page.click('text="全部已读"');
  await waitFor(() => !document.querySelector('.feedback-inbox .fb-item.is-new'));
  await page.click('text="清除已读"');
  await waitFor(() => !document.querySelector('.feedback-inbox .fb-item'));
  assert.equal((await read()).badge, badge(0, 0));
  await page.press('.feedback-inbox', 'Escape');
  await waitFor(() => !document.querySelector('.feedback-inbox:popover-open'));

  // Update progress stays on the settings page; each version outcome is unread once.
  const update = (state) => page.evaluate((state) => window.routing.setUpdate(state), state);
  await update({ status: 'checking', revision: 1 });
  await update({ status: 'not-available', latestVersion: '1.0.0', revision: 2 });
  assert.equal((await read()).badge, badge(0, 0));
  await update({ status: 'available', latestVersion: '1.0.1', revision: 3, background: true });
  await dismissDialog('Alune v1.0.1 可用');
  await update({ status: 'available', latestVersion: '1.0.1', revision: 4, background: false });
  assert.equal((await read()).badge, badge(1, 0));
  await update({ status: 'downloading', latestVersion: '1.0.1', revision: 5 });
  await waitFor(
    (text) =>
      document.querySelector('.status-button--feedback').getAttribute('aria-label') === text,
    badge(0, 0),
  );
  await update({ status: 'downloaded', latestVersion: '1.0.1', revision: 6 });
  await waitFor(
    (text) =>
      document.querySelector('.status-button--feedback').getAttribute('aria-label') === text,
    badge(1, 1),
  );
  await page.evaluate(() => window.routing.setWatching(true));
  await waitFor(
    (text) =>
      document.querySelector('.status-button--feedback').getAttribute('aria-label') === text,
    badge(1, 0),
  );
  await update({ status: 'available', latestVersion: '1.0.2', revision: 7, background: true });
  await waitFor(
    (text) =>
      document.querySelector('.status-button--feedback').getAttribute('aria-label') === text,
    badge(1, 0),
  );
  assert.equal((await read()).dialog, undefined);

  return {
    background: 'inbox',
    form: 'in place',
    closing: 'global',
    lifetime: 'kept',
    late: 'unread',
    inbox: 'dismiss/read/clear',
    updates: 'once per outcome',
  };
}
