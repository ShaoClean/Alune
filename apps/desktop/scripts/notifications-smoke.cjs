const assert = require('node:assert/strict');
const { existsSync, renameSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

module.exports = async ({ window, origin, token, updates }) => {
  const fixture = JSON.parse(process.env.ALUNE_NOTIFICATION_FIXTURE);
  const api = async (route, body) => {
    const response = await fetch(origin + '/api' + route, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, route + ': ' + response.status);
    return response.json();
  };
  const execute = (script) => window.webContents.executeJavaScript(script);
  const wait = (expression) =>
    execute(`new Promise((resolve, reject) => {
    const started = Date.now(); const poll = () => {
      if (${expression}) return resolve();
      if (Date.now() - started > 10000) return reject(Error('Notification smoke: ' + ${JSON.stringify(expression)} + ' | ' + document.body.innerText));
      setTimeout(poll, 30);
    }; poll();
  })`);
  const click = (selector) =>
    execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const openInbox = async () => {
    await click('.status-button--feedback');
    await wait('document.querySelector(".feedback-inbox:popover-open")');
  };
  const closeInbox = async () => {
    await click('[aria-label="关闭通知与提示"]');
    await wait('!document.querySelector(".feedback-inbox:popover-open")');
  };
  const connection = await api('/connections', {
    ...fixture.connection,
    name: '通知验收 SSH',
    authType: 'password',
  });
  const local = await api('/repositories', { source: 'local', path: fixture.path });
  const ssh = await api('/repositories', { connectionId: connection.id, path: fixture.path });
  await window.loadURL(origin + '/repositories/' + local.id);
  await wait(
    'document.querySelector(".status-button--feedback") && document.querySelector("[aria-label=拉取]")',
  );

  // The real update service publishes through preload IPC; foreground checks stay in the inbox.
  await updates.check({ background: false });
  await wait('document.querySelector(".feedback-list").textContent.includes("可用")');
  assert.equal(await execute('Boolean(document.querySelector(".feedback-dialog:modal"))'), false);
  await openInbox();
  assert.equal(await execute('document.querySelectorAll(".fb-item").length'), 1);
  await execute(
    '[...document.querySelectorAll(".fb-item-actions button")].find(node => node.textContent.includes("查看更新")).click()',
  );
  await wait('location.pathname === "/settings/updates"');
  await openInbox();
  assert.equal(await execute('document.querySelectorAll(".fb-item").length'), 1);
  await closeInbox();

  // Fail the actual desktop preference write in this disposable profile, then recover it.
  const preferences = path.join(process.env.ALUNE_SMOKE_DIR, 'workspace.json');
  const backup = preferences + '.backup';
  if (existsSync(preferences)) renameSync(preferences, backup);
  mkdirSync(preferences);
  try {
    await click('[aria-controls="workspace-sidebar"]');
    await wait(
      'document.querySelector(".feedback-dialog:modal")?.textContent.includes("无法保存外观与工作区设置")',
    );
    await click('[aria-label="关闭提示"]');
    await openInbox();
    assert.equal(await execute('document.querySelectorAll(".fb-item").length'), 2);
    await closeInbox();
  } finally {
    rmSync(preferences, { recursive: true, force: true });
    if (existsSync(backup)) renameSync(backup, preferences);
  }
  await click('[aria-controls="workspace-sidebar"]');
  await wait('document.querySelectorAll(".fb-item").length === 1');

  for (const repo of [local, ssh]) {
    // Client navigation preserves application notices while changing repository ownership.
    await execute(
      `history.pushState({}, '', ${JSON.stringify('/repositories/' + repo.id)}); dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await wait(
      'document.querySelector(".branch-pill__name")?.textContent.includes("main") && document.querySelector("[aria-label=拉取]")?.getAttribute("aria-disabled") === "false"',
    );
    await click('[aria-label="拉取"]');
    await wait(
      'document.querySelector(".feedback-dialog:modal")?.textContent.includes("Git 操作未完成")',
    );
    await click('[aria-label="关闭提示"]');
    await openInbox();
    const notices = await execute(
      '[...document.querySelectorAll(".fb-item strong")].map(node => node.textContent)',
    );
    assert.equal(notices.filter((title) => title === 'Git 操作未完成').length, 1);
    assert.equal(notices.filter((title) => title.includes('可用')).length, 1);
    assert.equal(await execute('document.querySelectorAll(".status-button--feedback").length'), 1);
    assert.equal(
      await execute('document.querySelectorAll(".feedback-tray,.status-notifications").length'),
      0,
    );
    await execute(
      '[...document.querySelectorAll(".fb-item-actions button")].find(node => node.textContent.includes("刷新状态")).click()',
    );
    await wait(
      '![...document.querySelectorAll(".fb-item strong")].some(node => node.textContent === "Git 操作未完成")',
    );
    await closeInbox();
  }
  // A background update failure remains actionable outside settings and retries through IPC.
  const originalCheck = updates.adapter.check;
  updates.adapter.check = async () => {
    throw new Error('更新验收网络离线');
  };
  try {
    await updates.check({ background: true });
    await wait(
      'document.querySelector(".feedback-dialog:modal")?.textContent.includes("版本更新未完成")',
    );
  } finally {
    updates.adapter.check = originalCheck;
  }
  await click('.feedback-dialog .ant-btn-primary');
  await wait(
    'document.querySelector(".feedback-list").textContent.includes("可用") && !document.querySelector(".feedback-dialog:modal")',
  );
  assert.equal(await execute('document.querySelectorAll(".fb-item").length'), 1);
  window.setSize(360, 640);
  await wait('innerWidth === 360');
  await openInbox();
  await wait(
    'document.querySelector(".feedback-inbox").getAnimations().every(animation => animation.playState === "finished")',
  );
  assert.equal(
    await execute(`(() => {
    const panel = document.querySelector('.feedback-inbox').getBoundingClientRect();
    const trigger = document.querySelector('.status-button--feedback').getBoundingClientRect();
    return panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= trigger.top && trigger.right <= innerWidth;
  })()`),
    true,
  );
  if (process.env.ALUNE_NOTIFICATION_SCREENSHOT)
    writeFileSync(
      process.env.ALUNE_NOTIFICATION_SCREENSHOT,
      (await window.webContents.capturePage()).toPNG(),
    );
  await closeInbox();
  console.log(
    'Desktop notification acceptance passed: real local and SSH Git failures, update preload IPC, settings write failure/recovery, deduplication, action removal, repository navigation and 360px layout.',
  );
};
