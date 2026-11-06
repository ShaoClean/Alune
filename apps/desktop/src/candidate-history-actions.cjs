const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, wc, work, wait: rawWait, pass }) => {
  const wait = async (contents, condition) => {
    try {
      return await rawWait(contents, condition);
    } catch (error) {
      console.error(
        'History condition:',
        condition,
        await wc.executeJavaScript(
          'JSON.stringify({url:location.href,body:document.body.innerText.slice(-1600)})',
        ),
      );
      throw error;
    }
  };
  const driver = require('./candidate-ui-driver.cjs')(wc, wait),
    { element, button, textButton, click, input } = driver;
  const ev = async (s) => {
      try {
        return await wc.executeJavaScript(s);
      } catch (error) {
        console.error(
          'History script:',
          s,
          await wc.executeJavaScript(
            'JSON.stringify({url:location.href,body:document.body.innerText.slice(-1800)})',
          ),
        );
        throw error;
      }
    },
    start = wc.getURL(),
    origin = new URL(start).origin;
  const root = fs.mkdtempSync(path.join(path.dirname(work), 'history-pages-')),
    repo = path.join(root, 'history-proof'),
    bare = path.join(root, 'origin.git');
  fs.mkdirSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-qb', 'main');
  git('config', 'user.name', 'History checkpoint');
  git('config', 'user.email', 'history@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.autocrlf', 'false');
  let stream = '';
  const data = (s) => 'data ' + Buffer.byteLength(s) + '\n' + s + '\n';
  for (let i = 0; i < 130; i++) {
    const who = i % 2 ? 'History Beta' : 'History Alpha',
      stamp = Math.floor(new Date(2025, 0, i < 65 ? 4 : 6, 12).getTime() / 1000) + i;
    stream +=
      'commit refs/heads/main\nmark :' +
      (i + 1) +
      '\nauthor ' +
      who +
      ' <history@example.invalid> ' +
      stamp +
      ' +0000\ncommitter ' +
      who +
      ' <history@example.invalid> ' +
      stamp +
      ' +0000\n' +
      data('history fixture ' + String(i).padStart(3, '0'));
    if (i === 60) stream += 'R before-name.txt after-name.txt\n';
    else
      stream +=
        'M 100644 inline ' +
        (i < 60 ? 'before-name.txt' : 'after-name.txt') +
        '\n' +
        data('version ' + i + '\n');
    if (i === 129) stream += 'M 100644 inline extra.txt\n' + data('separate head file\n');
    stream += '\n';
  }
  const sideDate = Math.floor(new Date(2025, 0, 7, 12).getTime() / 1000);
  for (let i = 0; i < 2; i++)
    stream +=
      'commit refs/heads/side\nmark :' +
      (1001 + i) +
      '\nauthor Side Only <side@example.invalid> ' +
      sideDate +
      ' +0000\ncommitter Side Only <side@example.invalid> ' +
      sideDate +
      ' +0000\n' +
      data('side only ' + i) +
      'from :' +
      (i ? 1001 : 21) +
      '\nM 100644 inline side.txt\n' +
      data('side ' + i + '\n') +
      '\n';
  stream += 'done\n';
  execFileSync('git', ['-C', repo, 'fast-import', '--quiet'], { input: stream, encoding: 'utf8' });
  git('reset', '--hard', 'main');
  const detail = git('rev-parse', 'HEAD');
  execFileSync('git', ['clone', '--bare', '-q', repo, bare]);
  git('remote', 'add', 'origin', bare);
  const hashes = (...args) =>
    git('log', '--topo-order', '--format=%H', ...args)
      .split(/\r?\n/)
      .filter(Boolean);
  await window.loadURL(origin + '/repositories');
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), repo);
  await click(textButton('检查仓库'));
  await click(textButton('打开工作区', '.a-dlg-actions button'));
  await click(button('提交历史'));
  const grid = element('.history-table'),
    viewport = element('.history-viewport');
  const count = 'Number((' + grid + ')?.getAttribute("aria-rowcount"))-1';
  const row = (h) => element('.history-row[data-hash="' + h + '"]');
  const key = async (expr, key) =>
    wait(
      wc,
      `(()=>{const e=(${expr});if(!e||e.disabled)return false;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}));return true})()`,
    );
  const scroll = async (y) =>
    ev(
      '(()=>{const v=(' +
        viewport +
        ');v.scrollTop=' +
        y +
        ';v.dispatchEvent(new Event("scroll",{bubbles:true}));return v.scrollTop})()',
    );
  await wait(wc, count + '===50');
  git('commit', '--allow-empty', '-qm', 'history checkpoint after initial page');
  const head = git('rev-parse', 'HEAD');
  await scroll(100000);
  await wait(
    wc,
    "document.querySelector('.feedback-dialog[open]')?.innerText.includes('历史已变化')",
  );
  assert.equal(await ev(count), 50);
  await click(textButton('刷新历史', '.feedback-dialog[open] button'));
  const loaded = async (expected) => {
    assert.ok(expected.length > 0);
    await scroll(0);
    await wait(
      wc,
      '(' +
        element('.history-table .history-row[aria-rowindex="2"]') +
        ')?.dataset.hash===' +
        JSON.stringify(expected[0]) +
        '&&' +
        count +
        '>=' +
        Math.min(50, expected.length) +
        '&&' +
        count +
        '<=' +
        expected.length,
    );
    for (let page = 0; page < 6 && (await ev(count)) < expected.length; page++) {
      const before = await ev(count);
      await scroll(100000);
      await wait(wc, count + '>' + before);
    }
    assert.equal(await ev(count), expected.length);
    const seen = new Map(),
      geometry = await ev(
        '(()=>{const v=(' +
          viewport +
          '),r=(' +
          grid +
          ').querySelector(".history-row");return {height:v.clientHeight,total:v.scrollHeight,row:r.getBoundingClientRect().height}})()',
      );
    assert.ok(geometry.height > 0 && geometry.row > 0);
    for (
      let y = 0;
      y <= geometry.total + geometry.height;
      y += Math.max(1, Math.floor(geometry.height / 2))
    ) {
      const actual = await scroll(y),
        needed = Math.min(expected.length + 1, Math.floor(actual / geometry.row) + 2);
      await wait(wc, element('.history-table .history-row[aria-rowindex="' + needed + '"]'));
      const rows = await ev(
        '[...(' +
          grid +
          ').querySelectorAll(".history-row")].map(e=>[Number(e.getAttribute("aria-rowindex")),e.dataset.hash])',
      );
      for (const [i, h] of rows) {
        if (seen.has(i)) assert.equal(seen.get(i), h);
        seen.set(i, h);
      }
    }
    assert.equal(seen.size, expected.length);
    const ordered = [...seen].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    assert.equal(new Set(ordered).size, expected.length);
    assert.deepEqual(ordered, expected);
  };
  await loaded(hashes('--all', 'HEAD'));
  await pass(
    ['UI-021'],
    'advance a real branch between history pages: stale paging stops at its original 50 rows; explicit refresh loads every Git commit without duplicates across virtualized pages',
  );
  await scroll(0);
  await wait(wc, row(detail));
  await click(row(detail));
  await click(button('查看提交文件 extra.txt'));
  await wait(
    wc,
    "document.querySelector('.history-detail')?.textContent.includes('separate head file')",
  );
  const apply = async (label, value) => {
    await input(button(label), value);
    await key(button(label), 'Enter');
  };
  await apply('按作者筛选', 'History Alpha');
  await loaded(hashes('--all', 'HEAD', '--author=History Alpha'));
  await click(textButton('清除筛选'));
  await wait(
    wc,
    'document.querySelector(".history-detail code[title]")?.title===' + JSON.stringify(detail),
  );
  await wait(
    wc,
    '(' + button('查看提交文件 extra.txt') + ')?.classList.contains("commit-file-row--selected")',
  );
  await wait(
    wc,
    "document.querySelector('.history-detail')?.textContent.includes('separate head file')",
  );
  await pass(
    ['UI-020', 'UI-021', 'UI-022'],
    'filter real commits by author; clearing the filter restores the selected commit and its exact file Diff',
  );
  await click(button('关闭提交详情'));
  await input(button('结束日期'), '2025-01-04');
  const early = hashes('--all', 'HEAD', '--until=2025-01-04T23:59:59');
  await loaded(early);
  await input(button('开始日期'), '2025-01-06');
  await wait(
    wc,
    "document.querySelector('.history-filter__error')?.textContent.includes('开始日期不能晚于结束日期')",
  );
  await loaded(early);
  await input(button('结束日期'), '2025-01-06');
  await loaded(
    hashes('--all', 'HEAD', '--since=2025-01-06T00:00:00', '--until=2025-01-06T23:59:59'),
  );
  await click(textButton('清除筛选'));
  await loaded(hashes('--all', 'HEAD'));
  await click(textButton('当前分支', '.ant-segmented-item'));
  await loaded(hashes('HEAD'));
  await pass(
    ['UI-020', 'UI-021'],
    'inclusive date filters match Git, an invalid range keeps the last valid rows, and current-branch scope excludes the independent side branch',
  );
  await apply('按文件或目录路径筛选', 'after-name.txt');
  await loaded(hashes('HEAD', '--', 'after-name.txt'));
  await click(element('.history-filter__follow [role=switch]'));
  await loaded(hashes('--follow', 'HEAD', '--', 'after-name.txt'));
  const old = git('log', 'main', '--format=%H', '--grep=history fixture 002');
  await scroll(100000);
  await wait(wc, row(old));
  await click(row(old));
  await wait(wc, button('查看提交文件 before-name.txt'));
  await click(button('查看提交文件 before-name.txt'));
  await wait(wc, "document.querySelector('.history-detail')?.textContent.includes('version 2')");
  const resize = button('调整提交图与详情高度');
  await key(resize, 'End');
  await wait(
    wc,
    '(' +
      resize +
      ').getAttribute("aria-valuenow")===(' +
      resize +
      ').getAttribute("aria-valuemax")',
  );
  await key(resize, 'Home');
  await wait(
    wc,
    '(' +
      resize +
      ').getAttribute("aria-valuenow")===(' +
      resize +
      ').getAttribute("aria-valuemin")',
  );
  assert.equal(await ev('document.querySelector(".history-detail code[title]")?.title'), old);
  await click(textButton('查看全部'));
  await wait(wc, "!document.querySelector('.commit-file-row--selected')");
  await pass(
    ['UI-020', 'UI-021', 'UI-022'],
    'follow a real rename into the old file path, select its original committed bytes, resize graph/detail with keyboard limits and return to all changed files without changing the commit',
  );
  await click(button('关闭提交详情'));
  await click(textButton('清除筛选'));
  await loaded(hashes('--all', 'HEAD'));
  await key(grid, 'Home');
  await key(grid, 'Enter');
  await wait(
    wc,
    'document.querySelector(".history-detail code[title]")?.title===' +
      JSON.stringify(hashes('--all', 'HEAD')[0]),
  );
  await pass(
    ['UI-021', 'UI-022'],
    'Home and Enter in the commit grid open the exact newest visible Git commit',
  );
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), '');
  await window.loadURL(origin + '/repositories');
  await click(button('删除 history-proof'));
  await click(textButton('移除登记'));
  await wait(wc, '!(' + button('删除 history-proof') + ')');
  assert.equal(git('rev-parse', 'HEAD'), head);
  await window.loadURL(start);
};
