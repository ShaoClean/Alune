const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');

module.exports = async ({ window, origin, token }) => {
  const fixture = JSON.parse(process.env.ALUNE_WORKTREE_FIXTURE);
  const request = async (route, body) => {
    const response = await fetch(origin + '/api' + route, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, route + ': ' + response.status);
    return response.json();
  };
  const connection = await request('/connections', {
    ...fixture.connection,
    name: 'Worktree smoke',
    authType: 'password',
  });
  const repo = await request('/repositories', { connectionId: connection.id, path: fixture.path });
  const evaluate = async (script) => {
    try {
      return await window.webContents.executeJavaScript(script);
    } catch (error) {
      throw new Error('Electron UI check failed: ' + script + '\n' + error.message);
    }
  };
  const wait = (condition) =>
    evaluate(
      'new Promise((resolve, reject) => {' +
        'const start = Date.now(); const check = () => { if (' +
        condition +
        ') return resolve(true);' +
        'if (Date.now() - start > 10000) return reject(new Error("UI timeout: " + ' +
        JSON.stringify(condition) +
        '));' +
        'setTimeout(check, 30); }; check(); })',
    );
  const click = (selector) =>
    evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
  await window.loadURL(origin + '/repositories/' + repo.id);
  await wait(
    'document.querySelector(".worktrees-trigger") && document.body.textContent.includes("main-new.txt")',
  );
  await click('.worktrees-trigger');
  await wait('document.querySelectorAll(".worktree-option").length === 4');
  await evaluate(
    '[...document.querySelectorAll(".worktree-option")].find(el => el.textContent.includes("feature/worktrees")).click()',
  );
  await wait(
    'document.querySelectorAll("[role=tab]").length === 2 && document.body.textContent.includes("feature-new.txt")',
  );
  const targetId = (await evaluate('location.pathname')).split('/').pop();
  assert.notEqual(targetId, repo.id);
  assert.equal((await request('/repositories')).length, 2);
  await click('button[aria-label="查看差异 tracked.txt（已暂存）"]');
  await wait('document.body.textContent.includes("feature staged")');
  await click('button[aria-label="暂存 feature-new.txt"]');
  await wait(
    'document.querySelector(' +
      JSON.stringify('button[aria-label="取消暂存 feature-new.txt"]') +
      ')',
  );
  const sourceStatus = await request('/repositories/' + repo.id + '/status');
  assert.equal(sourceStatus.files.find((file) => file.path === 'main-new.txt').staged, false);
  await click('.repository-tab__select');
  await wait('document.body.textContent.includes("main-new.txt")');
  await click('.worktrees-trigger');
  await wait('document.querySelectorAll(".worktree-option").length === 4');
  await evaluate(
    '[...document.querySelectorAll(".worktree-option")].find(el => el.textContent.includes("feature/worktrees")).click()',
  );
  await wait('location.pathname.endsWith(' + JSON.stringify(targetId) + ')');
  assert.equal(await evaluate('document.querySelectorAll("[role=tab]").length'), 2);
  await click('.repository-tab:last-child .repository-tab__close');
  await wait('document.querySelectorAll("[role=tab]").length === 1');
  assert.equal((await request('/repositories')).length, 2);
  await click('.worktrees-trigger');
  await wait('document.querySelectorAll(".worktree-option").length === 4');
  await evaluate(
    '[...document.querySelectorAll(".worktree-option")].find(el => el.textContent.includes("游离 HEAD")).click()',
  );
  await wait('document.querySelector(".branch-pill__name")?.textContent.includes("游离 HEAD")');
  window.setSize(320, 800);
  await wait('innerWidth === 320');
  await click('.worktrees-trigger');
  await wait(
    'document.querySelectorAll(".worktree-option").length === 4 && document.querySelector(".worktrees-menu").getBoundingClientRect().width > 250',
  );
  await wait('document.documentElement.scrollWidth <= innerWidth');
  if (process.env.ALUNE_WORKTREE_SCREENSHOT) {
    await wait('!document.querySelector(".ant-popover")?.className.includes("zoom-big")');
    writeFileSync(
      process.env.ALUNE_WORKTREE_SCREENSHOT,
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  console.log(
    'Worktree desktop acceptance passed: real SSH, independent tabs, staged Diff, stage isolation, deduplication, close, detached HEAD and 320px layout',
  );
};
