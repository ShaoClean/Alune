const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { Menu } = require('electron');

module.exports = async ({ window, origin, token }) => {
  const phase = process.env.ALUNE_SESSION_PHASE;
  const file = path.join(process.env.ALUNE_SMOKE_DIR, 'session-test.json');
  const fixture = JSON.parse(process.env.ALUNE_SESSION_FIXTURE);
  const execute = (code) => window.webContents.executeJavaScript(code);
  const wait = (condition) =>
    execute(`new Promise((resolve, reject) => {
    const start = Date.now(); const poll = () => {
      if (${condition}) return resolve();
      if (Date.now() - start > 12000) return reject(Error('Session timeout: ' + ${JSON.stringify(condition)} + ' at ' + location.pathname));
      setTimeout(poll, 20);
    }; poll();
  })`);
  const click = (selector) =>
    execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const request = async (route, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(origin + '/api' + route, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, route + ': ' + response.status);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const tab = (id) => `[data-repository-tab="${id}"]`;
  const select = async (id) => {
    await click(tab(id) + ' [role=tab]');
    await wait(`location.pathname === '/repositories/${id}'`);
  };
  const open = async (id) => {
    await click(`[data-repository-id="${id}"] .tree-node__action`);
    await wait(
      `location.pathname === '/repositories/${id}' && document.querySelector(${JSON.stringify(tab(id))})`,
    );
  };
  const session = () =>
    execute(
      'window.aluneWorkspace.load().then(value => JSON.parse(value).state.repositorySession)',
    );
  const check = async (expected) => {
    await wait(`location.pathname === ${JSON.stringify(expected.activeId ? '/repositories/' + expected.activeId : '/repositories')}
      && JSON.stringify([...document.querySelectorAll('[data-repository-tab]')].map(el => el.dataset.repositoryTab)) === ${JSON.stringify(JSON.stringify(expected.ids))}`);
    assert.deepEqual(await session(), expected);
  };
  const saveExpected = (state) => writeFileSync(file, JSON.stringify({ ...state, phase, origin }));
  let state;
  if (phase === 'write') {
    const connection = await request('/connections', {
      ...fixture.connection,
      name: 'Session SSH',
      authType: 'password',
    });
    const local = await request('/repositories', { source: 'local', path: fixture.local });
    const ssh = await request('/repositories', { connectionId: connection.id, path: fixture.ssh });
    const worktree = await request('/repositories', { source: 'local', path: fixture.worktree });
    state = { local: local.id, ssh: ssh.id, worktree: worktree.id };
    await window.loadURL(origin + '/repositories');
    await wait("document.querySelectorAll('[data-repository-id]').length === 3");
    for (const id of [state.local, state.ssh, state.worktree]) await open(id);
    await execute(
      `document.querySelector(${JSON.stringify(tab(state.worktree) + ' [role=tab]')}).dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', altKey:true, bubbles:true}))`,
    );
    await select(state.ssh);
    state.expected = { ids: [state.local, state.worktree, state.ssh], activeId: state.ssh };
    await check(state.expected);
    // Leave from the actual settings overlay and verify that a new process resumes the workspace.
    await execute(
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }))",
    );
    await wait("location.pathname.startsWith('/settings')");
    saveExpected(state);
    return;
  }
  state = JSON.parse(readFileSync(file, 'utf8'));
  assert.notEqual(origin, state.origin, 'each process uses a fresh HTTP origin');
  await check(state.expected);
  if (phase === 'normal') {
    // Exercise selection while sidebar status responses can re-render the previous route.
    for (let index = 0; index < 12; index++) {
      const id = index % 2 ? state.worktree : state.local;
      await open(id);
      assert.equal((await session()).activeId, id);
    }
    // Refresh and direct links retain the other tabs, while the address selects the active tab.
    await window.loadURL(origin + '/repositories/' + state.local);
    state.expected.activeId = state.local;
    await check(state.expected);
    await window.loadURL(origin);
    await check(state.expected);
    Menu.getApplicationMenu()
      .items.find((item) => item.label === '文件')
      .submenu.items[0].click();
    await wait("location.pathname === '/connections'");
    assert.deepEqual(await session(), state.expected);
    await window.loadURL(origin + '/repositories');
    await wait(
      "location.pathname === '/repositories' && document.querySelectorAll('[role=tab]').length === 3",
    );
    // A failed registry read preserves the saved session and offers a retry.
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Network.enable');
    await window.webContents.debugger.sendCommand('Network.setBlockedURLs', {
      urls: [origin + '/api/repositories'],
    });
    await window.loadURL(origin);
    await wait("document.body.textContent.includes('暂时无法恢复工作区')");
    assert.deepEqual(await session(), state.expected);
    await window.webContents.debugger.sendCommand('Network.setBlockedURLs', { urls: [] });
    await execute(
      "[...document.querySelectorAll('button')].find(el => el.textContent === '重试').click()",
    );
    await check(state.expected);
    window.webContents.debugger.detach();
  } else if (phase === 'crash-close') {
    await click(tab(state.worktree) + ' .repository-tab__close');
    state.expected.ids = [state.local, state.ssh];
  } else if (phase === 'crash-open') {
    await open(state.worktree);
    state.expected = { ids: [state.local, state.ssh, state.worktree], activeId: state.worktree };
  } else if (phase === 'crash-reorder') {
    await execute(
      `document.querySelector(${JSON.stringify(tab(state.worktree) + ' [role=tab]')}).dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', altKey:true, bubbles:true}))`,
    );
    state.expected.ids = [state.local, state.worktree, state.ssh];
  } else if (phase === 'crash-batch') {
    await execute(
      `document.querySelector(${JSON.stringify(tab(state.worktree))}).dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:400, clientY:25}))`,
    );
    await wait("document.querySelector('.repository-tab-menu') !== null");
    await execute(
      "[...document.querySelectorAll('.repository-tab-menu [role=menuitem]')].find(el => el.textContent.includes('关闭其他')).click()",
    );
    state.expected.ids = [state.worktree];
  } else if (phase === 'crash-all') {
    await click(tab(state.worktree) + ' .repository-tab__close');
    state.expected = { ids: [], activeId: null };
  } else if (phase === 'empty') {
    assert.deepEqual(state.expected, { ids: [], activeId: null });
  } else if (phase === 'delete') {
    for (const id of [state.local, state.ssh, state.worktree]) await open(id);
    await select(state.ssh);
    // External registry deletion leaves a stale saved active ID for the next startup to reconcile.
    await request('/repositories/' + state.ssh, undefined, 'DELETE');
    state.expected = { ids: [state.local, state.worktree], activeId: state.worktree };
    saveExpected(state);
    return;
  } else if (phase === 'pruned') {
    const ssh = await request('/repositories', {
      connectionId: (await request('/connections'))[0].id,
      path: fixture.ssh,
    });
    state.ssh = ssh.id;
    await window.loadURL(origin + '/repositories/' + state.ssh);
    state.expected = { ids: [state.local, state.worktree, state.ssh], activeId: state.ssh };
    await check(state.expected);
  } else if (phase === 'offline') {
    await wait(
      "document.body.textContent.includes('ECONNREFUSED') || document.body.textContent.includes('连接失败')",
    );
    assert.deepEqual(await session(), state.expected);
  }
  if (!phase.startsWith('crash-')) await check(state.expected);
  saveExpected(state);
  console.log('Repository session phase passed: ' + phase);
  if (phase.startsWith('crash-')) process.kill(process.pid, 'SIGKILL');
};
