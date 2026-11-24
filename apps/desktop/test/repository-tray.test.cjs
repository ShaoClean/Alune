const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { desktopPreferences, createRepositoryTray } = require('../src/repository-tray.cjs');

function fixture(t, platform = 'darwin') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'alune-tray-'));
  const prefs = desktopPreferences(dir);
  const tray = new EventEmitter();
  tray.setTitle = (title) => (tray.title = title);
  tray.setToolTip = (tip) => (tray.tip = tip);
  tray.setContextMenu = (menu) => (tray.menu = menu);
  tray.destroy = () => (tray.destroyed = true);
  const calls = [];
  const controller = createRepositoryTray({
    tray,
    Menu: { buildFromTemplate: (items) => items },
    platform,
    preferences: prefs,
    show: () => calls.push('show'),
    quit: () => calls.push('quit'),
    send: (channel, data) => calls.push([channel, data]),
  });
  t.after(() => {
    controller.destroy();
    rmSync(dir, { recursive: true, force: true });
  });
  return { prefs, tray, calls, controller, dir };
}
const tab = (id, branch = '') => ({ id, label: id, branch, offline: false, stale: false });

test('tab order, selection and late HEAD replies follow only the live workspace', (t) => {
  const { controller, tray, calls } = fixture(t);
  assert.equal(tray.menu[0].label, '尚未打开仓库');
  controller.setTabs({ activeId: 'A', tabs: [tab('A', 'main'), tab('B')] });
  const first = calls.at(-1)[1];
  assert.equal(tray.title, 'A · main');
  const oldA = tray.menu[1];
  controller.setTabs({ activeId: 'B', tabs: [tab('B'), tab('A', 'main')] });
  const second = calls.at(-1)[1];
  controller.acceptHead({ ...second, state: 'ready', label: '游离 HEAD · c0ffee12' });
  controller.acceptHead({ ...first, state: 'ready', label: 'wrong' });
  assert.equal(tray.title, 'B · 游离 HEAD · c0ffee12');
  assert.equal(tray.menu[1].checked, true);
  assert.equal(tray.menu[2].checked, false);
  tray.menu[2].click();
  assert.deepEqual(calls.slice(-2), ['show', ['tray:select', 'A']]);
  controller.setTabs({ activeId: 'B', tabs: [tab('B')] });
  oldA.click();
  assert.equal(calls.at(-1), 'show');
  controller.setTabs({ activeId: null, tabs: [] });
  assert.equal(tray.title, '');
  tray.menu.at(-1).click();
  assert.equal(calls.at(-1), 'quit');
});

test('offline and unsupported HEAD use cached text; reconnect requests fresh information', (t) => {
  const { controller, tray, calls } = fixture(t);
  const repo = tab('SSH', 'registered');
  controller.setTabs({ activeId: repo.id, tabs: [repo] });
  controller.acceptHead({ ...calls.at(-1)[1], label: 'live', state: 'ready' });
  controller.setTabs({ activeId: repo.id, tabs: [{ ...repo, offline: true }] });
  const count = calls.length;
  controller.refresh();
  assert.equal(calls.length, count);
  assert.match(tray.title, /live（离线，上次读取）/);
  controller.setTabs({ activeId: repo.id, tabs: [repo] });
  assert.equal(calls.length, count + 1);
  controller.acceptHead({ ...calls.at(-1)[1], state: 'cached' });
  assert.match(tray.title, /live（上次读取）/);
});

test('desktop settings survive restart and invalid or corrupt input retains valid defaults', (t) => {
  const { prefs, controller, tray, dir } = fixture(t);
  assert.deepEqual(prefs.get(), { showTitle: true, closeMode: 'ask' });
  controller.setTabs({ activeId: 'a', tabs: [tab('a', 'main')] });
  prefs.update({ showTitle: false, closeMode: 'hide' });
  controller.render();
  assert.equal(tray.title, '');
  assert.equal(tray.menu[1].label, 'a · main');
  assert.deepEqual(desktopPreferences(dir).get(), { showTitle: false, closeMode: 'hide' });
  assert.throws(() => prefs.update({ closeMode: 'exit-now' }));
  writeFileSync(path.join(dir, 'desktop.json'), '{');
  assert.equal(desktopPreferences(dir).get().closeMode, 'ask');
});
