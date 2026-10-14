const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { BrowserWindow } = require('electron');

// Opens the standalone log window through the preload bridge and checks history,
// the live stream, file output and that the per-launch credential is never written.
module.exports = async ({ window, origin, token }) => {
  assert.deepEqual(
    await window.webContents.executeJavaScript('Object.keys(window.aluneLogs).sort()'),
    ['chooseDirectory', 'openDirectory', 'openWindow'],
  );
  const before = BrowserWindow.getAllWindows().length;
  await window.webContents.executeJavaScript('window.aluneLogs.openWindow()');
  const logWindow =
    BrowserWindow.getAllWindows().find(
      (item) => item !== window && item.webContents.getURL().startsWith(`${origin}/logs`),
    ) ||
    (await new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        const found = BrowserWindow.getAllWindows().find((item) => item !== window);
        if (found) return resolve(found);
        if (Date.now() - started > 8000) return reject(new Error('Log window did not open'));
        setTimeout(poll, 20);
      };
      poll();
    }));
  assert.equal(BrowserWindow.getAllWindows().length, before + 1);
  // Opening again focuses the same window instead of creating another one.
  await window.webContents.executeJavaScript('window.aluneLogs.openWindow()');
  assert.equal(BrowserWindow.getAllWindows().length, before + 1);

  const wait = (condition) =>
    logWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now(); const poll = () => {
        if (${condition}) return resolve(true);
        if (Date.now() - started > 10000) return reject(Error(${JSON.stringify(condition)} + ': ' + document.body.innerText.slice(0, 500)));
        setTimeout(poll, 25);
      }; poll();
    })`);
  if (logWindow.webContents.isLoading())
    await new Promise((resolve) => logWindow.webContents.once('did-finish-load', resolve));
  await wait(`document.querySelector('.log-viewer__status--live')`);
  await wait(`document.body.innerText.includes('本地服务已启动')`);

  const marker = `smoke-log-${Date.now()}`;
  const response = await fetch(`${origin}/api/logs/client`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: 'WARN',
      message: `${marker} Authorization: Bearer ${token}`,
    }),
  });
  assert.equal(response.status, 204);
  await wait(`document.body.innerText.includes(${JSON.stringify(marker)})`);
  assert.equal(
    await logWindow.webContents.executeJavaScript(
      `document.body.innerText.includes(${JSON.stringify(token)})`,
    ),
    false,
  );

  const directory = path.join(process.env.ALUNE_SMOKE_DIR, 'logs');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const content = readdirSync(directory)
    .filter((name) => /^alune-.*\.log$/.test(name))
    .map((name) => readFileSync(path.join(directory, name), 'utf8'))
    .join('');
  assert.ok(content.includes(marker), 'log file contains the live entry');
  assert.ok(content.includes('Alune 启动'), 'main process startup is logged');
  assert.equal(content.includes(token), false, 'per-launch token is redacted');
  for (const line of content.trim().split('\n')) JSON.parse(line);

  const closed = new Promise((resolve) => logWindow.once('closed', resolve));
  logWindow.close();
  await closed;
};
