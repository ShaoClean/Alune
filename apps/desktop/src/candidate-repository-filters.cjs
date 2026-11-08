// Exercise RepositoriesPage itself, not the Layout repository switcher.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = async ({ window, origin, repo, other, wait, pass }) => {
  const wc = window.webContents, ev = (code) => wc.executeJavaScript(code);
  const { element, button, textButton, click, input, select } = require('./candidate-ui-driver.cjs')(wc, wait);
  const git = (dir) => execFileSync('git', ['-C', dir, 'status', '--porcelain=v1'], { encoding: 'utf8' });
  const before = [git(repo), git(other.path)];
  const entries = [repo, other.path].map((file) => ({ name: path.basename(file), path: file }));
  const rows = '[...document.querySelectorAll(".repository-table tbody tr")].map(e=>e.querySelector("th .collection-text").textContent)';
  const expect = async (names) => wait(wc, 'JSON.stringify(' + rows + ')===' + JSON.stringify(JSON.stringify(names)));
  await window.loadURL(origin + '/repositories');
  await click(button('列表视图'));
  const byName = [...entries].sort((a, b) => a.name.localeCompare(b.name)).map((r) => r.name);
  const byPath = [...entries].sort((a, b) => a.path.localeCompare(b.path)).map((r) => r.name);
  assert.notDeepEqual(byName, byPath, 'fixture must distinguish name from path sorting');
  await expect(byName);
  await select('仓库排序', '按路径');
  await expect(byPath);
  await select('仓库排序', '按名称');
  await expect(byName);
  await pass(['UI-070'], 'RepositoriesPage name/path sort toggles two registered real repositories whose name and path orders deliberately differ');

  await select('仓库来源', '本机');
  await wait(wc, 'new URLSearchParams(location.search).get("connectionId")==="@local"');
  await expect(byName);
  await input(element('.repo-search input'), path.basename(other.path));
  await expect([path.basename(other.path)]);
  await input(element('.repo-search input'), 'no-such-isolated-acceptance-repository');
  await wait(wc, 'document.querySelector(".repositories-page")?.textContent.includes("没有匹配的仓库")');
  await click(button('数据总览视图'));
  await click(textButton('清除筛选', '.repositories-page button'));
  await wait(wc, '!new URLSearchParams(location.search).has("connectionId")&&document.querySelector(".repo-search input")?.value===""');
  await click(button('列表视图'));
  await expect(byName);
  await pass(['UI-070'], 'RepositoriesPage own source selector and search filter exact membership; overview empty-state clear resets both URL source and search then restores both real repository rows');

  const target = '[...document.querySelectorAll(".repository-table tbody tr")].find(e=>e.querySelector("th .collection-text")?.textContent===' + JSON.stringify(path.basename(other.path)) + ')';
  await click('(' + target + ').querySelector("button")');
  await wait(wc, 'location.pathname===' + JSON.stringify(new URL(other.url).pathname));
  assert.deepEqual([git(repo), git(other.path)], before);
  await pass(['UI-070', 'UI-072'], 'RepositoriesPage table row open activates the exact registered working tree without changing either Git status');
};
