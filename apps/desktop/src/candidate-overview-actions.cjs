// Three dated Git commits exercise independent 7/30/90-day totals and drill-downs.
const fs = require('node:fs'),
  p = require('node:path'),
  assert = require('node:assert/strict'),
  { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, repo, wait, pass: record }) => {
  const w = window.webContents,
    { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(w, wait);
  assert.equal(
    fs.realpathSync.native(p.dirname(repo)),
    fs.realpathSync.native(process.env.ALUNE_SMOKE_DIR),
  );
  // Different parent paths make name and path order observably different.
  const trend = p.join(p.dirname(repo), 'a-sort-fixture', 'Trend fixture');
  fs.mkdirSync(trend, { recursive: true });
  const git = (dir, args, env = {}) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, ...env },
    }).trim();
  git(trend, ['init', '-qb', 'main']);
  git(trend, ['config', 'user.name', 'Trend']);
  git(trend, ['config', 'user.email', 'trend@invalid']);
  git(trend, ['config', 'commit.gpgSign', 'false']);
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const day = 86400000,
    mid = midnight.getTime();
  for (const n of [42, 12, 2]) {
    const date = new Date(mid - n * day + 12 * 3600000).toISOString();
    fs.appendFileSync(p.join(trend, 'metric.ts'), 'export const day' + n + '=' + n + ';\n');
    git(trend, ['add', 'metric.ts']);
    git(trend, ['commit', '-qm', 'day ' + n], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }
  const names = [p.basename(repo), p.basename(trend)],
    head = git(trend, ['rev-parse', 'HEAD']),
    states = [repo, trend].map((d) => git(d, ['status', '--porcelain']));
  const history = [repo, trend].map((dir) =>
    git(dir, ['log', '--format=%ct']).split('\n').map(Number),
  );
  const dates = history.flat();
  const ev = (s) => w.executeJavaScript(s),
    allBtn = (scope, predicate) =>
      `[...document.querySelectorAll(${JSON.stringify(scope)})].filter(e=>e.getClientRects().length&&!e.closest('[inert]')).find(e=>${predicate})`;
  const metric = (name) =>
    allBtn(
      '.overview-metric',
      'e.querySelector("span")?.textContent.trim()===' + JSON.stringify(name),
    );
  const modal = element('.a-dlg-shell'),
    visibleRows =
      '[...document.querySelectorAll(".a-dlg-shell tbody tr")].filter(e=>e.getClientRects().length).map(e=>e.innerText)';
  const close = async () => {
    await click(textButton('关闭', '.a-dlg-shell button'));
    await wait(w, '!(' + modal + ')');
  };
  const rowsExpected = async (exact) => {
    await wait(
      w,
      visibleRows +
        '.length===' +
        exact.length +
        ' && ' +
        JSON.stringify(exact) +
        '.every(name=>' +
        visibleRows +
        '.some(text=>text.includes(name)))',
    );
  };
  await window.loadURL(origin + '/repositories');
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), trend);
  await click(textButton('检查仓库'));
  await click(textButton('打开工作区', '.a-dlg-actions button'));
  await wait(w, button('当前分支 main，切换分支'));
  const trendURL = w.getURL();
  await require('./candidate-repository-filters.cjs')({ window, origin, repo,
    other: { path: trend, url: trendURL }, wait, pass: record });
  await window.loadURL(origin + '/repositories');
  await click(button('卡片视图'));
  await click(button('刷新仓库'));
  await click(button('数据总览视图'));
  await click(button('采集统计'));
  await wait(
    w,
    "document.body.innerText.includes('采集统计')&&document.body.innerText.includes('统计覆盖 2/2')",
  );
  const sample = {};
  for (const d of [7, 30, 90]) {
    await click(textButton('近' + d + '天'));
    const count = dates.filter((v) => v * 1000 >= mid - d * day && v * 1000 < mid).length;
    sample[d] = count;
    await wait(
      w,
      '(' +
        metric('本期提交') +
        ')?.querySelector("strong")?.textContent.trim()===' +
        JSON.stringify(String(count)),
    );
  }
  assert.ok(sample[7] >= 1);
  assert.equal(sample[30] - sample[7], 1);
  assert.equal(sample[90] - sample[30], 1);
  await click(metric('仓库总数'));
  await rowsExpected(names);
  await close();
  await click(metric('活跃仓库'));
  await rowsExpected(
    names.filter((_, i) => history[i].some((t) => t * 1000 >= mid - 90 * day && t * 1000 < mid)),
  );
  await close();
  await record(
    ['UI-039', 'UI-070'],
    'metric drill-down separates total and active repositories; 7/30/90-day commit counts match actual UTC Git commit dates',
    sample,
  );
  await click(textButton('逐日明细 →'));
  const exactDate = new Date(mid - 12 * day).toISOString().slice(0, 10);
  const trendRow = allBtn(
    '.a-dlg-shell tbody tr',
    'e.querySelector("th")?.textContent===' + JSON.stringify(exactDate),
  );
  await wait(w, '(' + trendRow + ')?.querySelector("td")?.textContent==="1"');
  await click('(' + trendRow + ')?.querySelector("button")');
  await rowsExpected([names[1]]);
  await close();
  await wait(w, '(' + metric('有未提交改动') + ')?.querySelector("strong")?.textContent==="1"');
  await click(metric('有未提交改动'));
  await rowsExpected([names[0]]);
  await close();
  await click(button('本机 · 干净 · 1 个仓库'));
  await rowsExpected([names[1]]);
  await close();
  await wait(
    w,
    `(()=>{const e=(${element('.overview-ring-segment.is-dirty')});if(!e)return false;e.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;})()`,
  );
  await rowsExpected([names[0]]);
  await close();
  await record(
    ['UI-039'],
    'dirty working tree and clean local repository appear in the correct metric, source segment and chart drill-downs',
  );
  await click(element('[aria-label="来源分布"] .overview-link'));
  await rowsExpected(names);
  await close();
  await click(element('[aria-label="活跃仓库排行"] button'));
  await rowsExpected([names[1]]);
  await close();
  await record(
    ['UI-039'],
    'date drill-down matches its sole contributing repository; source and activity ranking show the correct memberships',
    { date: exactDate, active: names[1], localCount: 2 },
  );
  const language = allBtn(
    '[aria-label="主要语言分布"] button',
    "e.textContent.includes('TypeScript')",
  );
  await click(language);
  await wait(w, visibleRows + '.some(t=>t.includes(' + JSON.stringify(names[1]) + '))');
  await close();
  const filter = (name) => textButton(name, '[aria-label="关注仓库筛选"] button');
  await click(filter('有改动'));
  await wait(w, '(' + filter('有改动') + ').getAttribute("aria-pressed")==="true"');
  await click(filter('全部'));
  await wait(w, '(' + filter('全部') + ').getAttribute("aria-pressed")==="true"');
  await click(metric('仓库总数'));
  await rowsExpected(names);
  const targetRow = allBtn(
    '.a-dlg-shell tbody tr',
    'e.innerText.includes(' + JSON.stringify(names[1]) + ')',
  );
  await click('(' + targetRow + ').querySelector("button")');
  await wait(w, 'location.pathname===' + JSON.stringify(new URL(trendURL).pathname));
  assert.equal(git(trend, ['rev-parse', 'HEAD']), head);
  assert.deepEqual(
    [repo, trend].map((d) => git(d, ['status', '--porcelain'])),
    states,
  );
  await record(
    ['UI-039', 'UI-070', 'UI-072'],
    'language and attention filters, then open the chosen registered working tree from the detail table; Git state is unchanged',
    { sha: head },
  );
  await window.loadURL(origin + '/repositories');
  await click(button('卡片视图'));
  await click(button('删除 ' + names[1]));
  await click(textButton('移除登记'));
  await wait(w, '!(' + button('删除 ' + names[1]) + ')');
  assert.equal(git(trend, ['rev-parse', 'HEAD']), head);
};
