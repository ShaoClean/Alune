const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, id, repo, wait, pass }) => {
  const wc = window.webContents,
    ev = (s) => wc.executeJavaScript(s);
  const { element, button, textButton, click, input, select } =
    require('./candidate-ui-driver.cjs')(wc, wait);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const before = [git('rev-parse', 'HEAD'), git('status', '--porcelain'), git('show-ref')];
  const index = fs.readFileSync(path.join(repo, '.git', 'index')),
    branch = git('branch', '--show-current'),
    name = path.basename(repo);
  const original = wc.getURL();
  await window.loadURL(origin + '/branches');
  const row =
    '[...document.querySelectorAll(".branch-overview tbody tr")].find(e=>e.querySelector(".repository-identity__name")?.textContent===' +
    JSON.stringify(name) +
    ')';
  const search = button('搜索仓库、分支或路径');
  await click(textButton('刷新', '.branch-overview__toolbar button'));
  await wait(
    wc,
    '(' +
      row +
      ')?.querySelector(".repository-branch-cell__name")?.textContent===' +
      JSON.stringify(branch),
  );
  await click('(' + row + ').querySelector("[data-compact-row-button]")');
  await wait(
    wc,
    'document.querySelector(".repository-detail-strip__path")?.textContent.includes(' +
      JSON.stringify(repo) +
      ')',
  );
  await input(search, name);
  await wait(
    wc,
    'document.querySelectorAll(".branch-overview [data-compact-row-button]").length===1',
  );
  await input(search, 'no-branch-overview-fixture-match');
  await wait(
    wc,
    'document.querySelector(".branch-overview .empty-state")?.textContent.includes("没有匹配")',
  );
  await click(textButton('清除筛选', '.branch-overview button'));
  await wait(wc, row);
  await select('筛选连接', '本机');
  await wait(wc, 'new URLSearchParams(location.search).get("connectionId")==="@local"');
  await wait(
    wc,
    '(' +
      row +
      ')?.querySelector(".repository-branch-cell__name")?.textContent===' +
      JSON.stringify(branch),
  );
  assert.ok(
    (await ev('document.querySelector(".branch-overview__summary").textContent')).includes(
      '个状态有效',
    ),
  );
  await pass(
    ['UI-071'],
    'branch overview refresh reads the real Git branch; selecting its row exposes the exact path, source/search filters retain it and the empty-state action clears the search',
  );
  const config = path.join(repo, '.git', 'config'),
    saved = fs.readFileSync(config);
  fs.appendFileSync(config, '\n[invalid-branch-overview-fixture\n');
  try {
    assert.throws(() => git('status', '--porcelain'));
    await click(button('刷新 ' + name + ' 状态'));
    await wait(
      wc,
      '(' + row + ')?.querySelector(".repository-branch-cell--stale")?.innerText.includes("失败")',
    );
    assert.equal(
      await ev('(' + row + ').querySelector(".repository-branch-cell__name").textContent'),
      branch,
    );
    assert.ok(
      (await ev('document.querySelector(".repository-detail-strip__state").textContent')).includes(
        '缓存',
      ),
    );
  } finally {
    fs.writeFileSync(config, saved);
  }
  await click(button('刷新 ' + name + ' 状态'));
  await wait(
    wc,
    '(' +
      row +
      ')?.querySelector(".repository-branch-cell")&&!(' +
      row +
      ').querySelector(".repository-branch-cell--stale")',
  );
  await click(textButton('打开工作区', '.repository-detail-strip button'));
  await wait(wc, 'location.pathname===' + JSON.stringify('/repositories/' + id));
  await wait(
    wc,
    'document.querySelector(".branch-pill__name")?.textContent.trim()===' + JSON.stringify(branch),
  );
  await pass(
    ['UI-071', 'UI-036'],
    'a genuinely malformed Git config leaves the last known branch visibly stale; restoring its exact bytes and explicitly refreshing recovers status, and the detail strip opens that same repository',
  );
  await window.loadURL(origin + '/branches');
  await wait(wc, row);
  await ev(
    '(()=>{const e=(' +
      row +
      ').querySelector("[data-compact-row-button]");e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))})()',
  );
  await wait(wc, 'location.pathname===' + JSON.stringify('/repositories/' + id));
  assert.deepEqual(
    [git('rev-parse', 'HEAD'), git('status', '--porcelain'), git('show-ref')],
    before,
  );
  assert.deepEqual(fs.readFileSync(path.join(repo, '.git', 'index')), index);
  await pass(
    ['UI-071'],
    'Enter on the branch overview row opens its exact registered workspace while HEAD, all refs, Git index and working bytes remain unchanged',
  );
  await window.loadURL(original);
};
