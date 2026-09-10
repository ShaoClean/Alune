const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

module.exports = async ({ window, origin, token, restore }) => {
  const fixturePath = path.join(process.env.REMOTE_GIT_SMOKE_DIR, 'sidebar-smoke.json');
  const execute = (script) => window.webContents.executeJavaScript(script);
  const waitFor = (expression) => execute(`new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (${expression}) return resolve(true);
      if (Date.now() - start > 15000) return reject(new Error('Sidebar state did not settle'));
      setTimeout(check, 30);
    };
    check();
  })`);
  const api = async (resource, body) => {
    const response = await fetch(`${origin}/api/${resource}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok);
    return response.json();
  };
  let fixture;
  if (restore) {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  } else {
    const config = { host: '127.0.0.1', port: 1, username: 'smoke', authType: 'password', password: 'test-only' };
    const a = await api('connections', { ...config, name: 'Sidebar A' });
    const b = await api('connections', { ...config, name: 'Sidebar B' });
    const repos = [];
    for (const name of ['first', 'second', 'last']) repos.push(await api('repositories', { connectionId: a.id, path: `/sidebar-smoke/${name}` }));
    await api('repositories', { connectionId: b.id, path: '/sidebar-smoke/other' });
    fixture = { a: a.id, b: b.id, repos: repos.map((repo) => repo.id), origin };
    await window.loadURL(`${origin}/repositories`);
  }

  await waitFor("document.querySelectorAll('.tree-group').length === 2 && document.querySelectorAll('[data-repository-id]').length === 4");
  assert.deepEqual(await execute('Object.keys(window.remoteGitWorkspace).sort()'), ['clear', 'load', 'save']);
  const { a, b, repos } = fixture;
  if (!restore) {
    await execute(`(() => {
      const group = document.querySelector('[data-connection-id="${b}"]');
      group.querySelector('.tree-node__action').click();
      const handle = group.querySelector('.tree-sort-handle');
      handle.focus();
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    })()`);
    await execute(`(() => {
      const handle = document.querySelector('[data-repository-id="${repos[2]}"] .tree-sort-handle');
      const target = document.querySelector('[data-repository-id="${repos[0]}"]');
      const dataTransfer = new DataTransfer();
      handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      const clientY = target.getBoundingClientRect().top + 1;
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY }));
      handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    })()`);
    assert.equal(await execute('location.pathname'), '/repositories');
    writeFileSync(fixturePath, JSON.stringify(fixture));
  }

  const expectedOrder = [repos[2], repos[0], repos[1]];
  await waitFor(`document.querySelector('.tree-group')?.dataset.connectionId === ${JSON.stringify(b)}
    && document.querySelector('[data-connection-id="${b}"] .tree-node__action')?.getAttribute('aria-expanded') === 'false'
    && JSON.stringify([...document.querySelectorAll('[data-connection-id="${a}"] [data-repository-id]')].map((row) => row.dataset.repositoryId)) === ${JSON.stringify(JSON.stringify(expectedOrder))}`);
  const saved = JSON.parse(await execute('window.remoteGitWorkspace.load()')).state;
  assert.deepEqual(saved.connectionOrder, [b, a]);
  assert.deepEqual(saved.collapsedConnectionIds, [b]);
  assert.deepEqual(saved.repositoryOrderByConnection[a], expectedOrder);
  assert.equal(saved.validatedConnectionIds, undefined);
  if (!restore) {
    const extras = [];
    for (let index = 0; index < 24; index++) extras.push(await api('repositories', { connectionId: a, path: `/sidebar-smoke/archive-${index}` }));
    await window.loadURL(`${origin}/repositories`);
    await waitFor("document.querySelectorAll('[data-repository-id]').length === 28");
    const beforeDrag = await execute('window.remoteGitWorkspace.load()');
    await execute(`(() => {
      const container = document.querySelector('.app-sidebar__content');
      const rect = container.getBoundingClientRect();
      const handle = document.querySelector('[data-repository-id="${repos[2]}"] .tree-sort-handle');
      const target = document.elementFromPoint(rect.left + 120, rect.bottom - 8).closest('[data-repository-id]');
      if (!target) throw new Error('No visible repository at the scroll edge');
      const dataTransfer = new DataTransfer();
      handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY: rect.bottom - 8 }));
    })()`);
    await waitFor("document.querySelector('.app-sidebar__content').scrollTop > 100");
    await execute("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor("document.querySelectorAll('.tree-item--dragging').length === 0");
    assert.equal(await execute('window.remoteGitWorkspace.load()'), beforeDrag);
    for (const extra of extras) {
      const response = await fetch(`${origin}/api/repositories/${extra.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      assert.ok(response.ok);
    }
    await window.loadURL(`${origin}/repositories`);
    await waitFor("document.querySelectorAll('[data-repository-id]').length === 4");
    console.log('Desktop long-list edge scrolling and Escape cancellation passed.');
  }
  assert.equal(await execute("window.remoteGitWorkspace.save('{invalid').then(() => false, () => true)"), true);
  if (restore) {
    await execute('window.remoteGitWorkspace.clear()');
    assert.equal(await execute('window.remoteGitWorkspace.load()'), null);
    console.log(`Desktop sidebar restore passed across process restart (${fixture.origin} -> ${origin}).`);
  } else {
    console.log('Desktop sidebar UI passed: folding, keyboard and drag sorting, and disk persistence.');
  }
};
