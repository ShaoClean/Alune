const assert = require('node:assert/strict');

module.exports = async ({ window, origin, restore }) => {
  const execute = (script) => window.webContents.executeJavaScript(script);
  const wait = (condition) =>
    execute(`new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (${condition}) return resolve();
      if (Date.now() - start > 8000) return reject(Error('Appearance UI timeout'));
      setTimeout(poll, 30);
    }; poll();
  })`);
  if (restore) {
    await wait(
      "document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.reducedMotion === 'true'",
    );
    const saved = JSON.parse(await execute('window.aluneWorkspace.load()')).state;
    assert.deepEqual(saved.appearance, { theme: 'dark', reduceMotion: true });
    assert.equal(window.getBackgroundColor().toLowerCase(), '#151e30');
    console.log(
      'Desktop appearance survived process restart and changed HTTP origin; native background matches.',
    );
    return;
  }
  const previous = JSON.parse(await execute('window.aluneWorkspace.load()')).state;
  await window.loadURL(`${origin}/settings/appearance`);
  await wait("document.querySelector('input[value=dark]') !== null");
  await execute(
    "document.querySelector('input[value=dark]').click(); document.querySelector('[role=switch][aria-label=\"减少动态效果\"]').click()",
  );
  await wait(
    "document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.reducedMotion === 'true'",
  );
  const saved = JSON.parse(await execute('window.aluneWorkspace.load()')).state;
  assert.deepEqual(saved.appearance, { theme: 'dark', reduceMotion: true });
  for (const key of [
    'layout',
    'connectionOrder',
    'collapsedConnectionIds',
    'repositoryOrderByConnection',
  ]) {
    assert.deepEqual(saved[key], previous[key]);
  }
  await window.loadURL(`${origin}/repositories`);
  await wait("document.querySelector('.app-sidebar') !== null");
  assert.equal(await execute('document.documentElement.dataset.theme'), 'dark');
  assert.equal(
    await execute("getComputedStyle(document.querySelector('.app-sidebar')).backgroundColor"),
    'rgb(16, 26, 45)',
  );
  console.log(
    'Desktop appearance UI, reload, reduced motion and existing layout/order preservation passed.',
  );
};
