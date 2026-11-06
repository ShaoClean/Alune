const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, wc, work, wait: rawWait, fact, pass }) => {
  const wait = async (contents, condition) => {
    try {
      return await rawWait(contents, condition);
    } catch (error) {
      console.error(
        'History condition:',
        condition,
        await wc.executeJavaScript(
          'JSON.stringify({url:location.href,pointer:window.__historyPointer,body:document.body.innerText.slice(-1600)})',
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
    stream += 'M 100644 inline extra.txt\n' + data('extra version ' + i + '\n');
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
  const detail = git('rev-parse', 'HEAD~2'),
    detailExtra = git('show', detail + ':extra.txt');
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
    "document.querySelector('.history-detail')?.textContent.includes(" +
      JSON.stringify(detailExtra) +
      ')',
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
    "document.querySelector('.history-detail')?.textContent.includes(" +
      JSON.stringify(detailExtra) +
      ')',
  );
  await pass(
    ['UI-020', 'UI-021', 'UI-022'],
    'filter real commits by author; clearing the filter restores the selected commit and its exact file Diff',
  );
  const selectedCode = () => ev('document.querySelector(".history-detail code[title]")?.title');
  await click(button('在整个文件中查看差异'));
  await wait(wc, '(' + button('在整个文件中查看差异') + ')?.getAttribute("aria-pressed")==="true"');
  assert.equal(await selectedCode(), detail);
  await wait(
    wc,
    "document.querySelector('.history-detail')?.textContent.includes(" +
      JSON.stringify(detailExtra) +
      ')',
  );
  await click(button('在整个文件中查看差异'));
  const wasCollapsed = await ev(
    "document.querySelector('.app-shell').classList.contains('app-shell--collapsed')",
  );
  await click(button('专注阅读差异'));
  await wait(
    wc,
    "document.querySelector('.history-workspace--focus .history-workspace__graph')?.inert===true",
  );
  assert.equal(await selectedCode(), detail);
  await click(button('返回提交图'));
  await wait(wc, "!document.querySelector('.history-workspace--focus')");
  assert.equal(await selectedCode(), detail);
  if (
    (await ev(
      "document.querySelector('.app-shell').classList.contains('app-shell--collapsed')",
    )) !== wasCollapsed
  ) {
    await ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true}))");
    await wait(
      wc,
      "document.querySelector('.app-shell').classList.contains('app-shell--collapsed')===" +
        JSON.stringify(wasCollapsed),
    );
  }
  await pass(
    ['UI-022', 'UI-015'],
    'toggle the selected historical file between full-file and changes-only Diff, enter focused reading and return to the same commit and file',
  );
  const tagName = 'history-selected-commit';
  await click(textButton('创建标签', '.history-detail__header button'));
  await input(button('标签名称'), tagName);
  await click(textButton('取消', '.a-dlg-actions button'));
  assert.equal(git('tag', '--list', tagName), '');
  assert.equal(await selectedCode(), detail);
  await click(textButton('创建标签', '.history-detail__header button'));
  await input(button('标签名称'), tagName);
  await click(textButton('创建标签', '.a-dlg-actions button'));
  await fact(() => git('tag', '--list', tagName) === tagName, 'history tag was not created');
  assert.equal(git('rev-parse', tagName + '^{}'), detail);
  assert.notEqual(detail, head);
  assert.equal(git('rev-parse', 'HEAD'), head);
  await wait(
    wc,
    `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(!n)return false;const title=n.querySelector('#feedback-title')?.textContent;if(title===${JSON.stringify('已创建标签 ' + tagName)})return true;if(n.dataset.tone==='info'&&/进行中$/.test(title??'')){n.querySelector('[aria-label="关闭提示"]').click();return false;}throw Error(n.innerText)})()`,
  );
  await click(element('.feedback-dialog[open] [aria-label="关闭提示"]'));
  await wait(wc, "!document.querySelector('.feedback-dialog[open]')");
  await wait(
    wc,
    'document.querySelector(".history-detail code[title]")?.title===' + JSON.stringify(detail),
  );
  await pass(
    ['UI-022', 'UI-013'],
    'cancel then create a tag from historical commit details; the ref points to the selected old commit rather than HEAD, and the working branch stays unchanged',
  );
  const originalSize = window.getSize();
  try {
    window.setSize(600, 760);
    await wait(wc, "document.querySelector('.history-workspace--compact')");
    assert.equal(await selectedCode(), detail);
    await click(button('返回列表'));
    await wait(wc, "!document.querySelector('.history-detail')");
    await wait(wc, row(detail));
    await click(row(detail));
    await wait(
      wc,
      'document.querySelector(".history-detail code[title]")?.title===' + JSON.stringify(detail),
    );
    await pass(
      ['UI-022', 'UI-021'],
      'compact history returns from details to the grid, then reopens the same selected Git commit',
    );
  } finally {
    window.setSize(...originalSize);
  }
  await wait(wc, "!document.querySelector('.history-workspace--compact')");
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
  await pass(
    ['UI-020', 'UI-021', 'UI-022'],
    'follow a real rename into the old file path and select its exact original committed bytes',
  );
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
  const geometry = () =>
    ev(
      '({graph:document.querySelector(".history-workspace__graph").getBoundingClientRect().height,detail:document.querySelector(".history-detail").getBoundingClientRect().height})',
    );
  const minimumGeometry = await geometry();
  await key(resize, 'End');
  await wait(
    wc,
    '(' +
      resize +
      ').getAttribute("aria-valuenow")===(' +
      resize +
      ').getAttribute("aria-valuemax")',
  );
  const maximumGeometry = await geometry();
  assert.ok(maximumGeometry.graph > minimumGeometry.graph + 10);
  assert.ok(maximumGeometry.detail < minimumGeometry.detail - 10);
  await key(resize, 'Home');
  await wait(
    wc,
    '(' +
      resize +
      ').getAttribute("aria-valuenow")===(' +
      resize +
      ').getAttribute("aria-valuemin")',
  );
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.ALUNE_TEST_HISTORY_POINTER === '1') {
    if (process.env.GITHUB_ACTIONS === 'true')
      assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
    // Keep this test-owned window visible for later terminal/UI scenarios;
    // hiding it would suspend Chromium rendering. The harness closes it.
    await require('./smoke-window.cjs')(window);
    const beforeRatio = await ev('Number((' + resize + ').getAttribute("aria-valuenow"))');
    const before = await geometry(),
      rect = await ev('(' + resize + ').getBoundingClientRect().toJSON()');
    const x = Math.round(rect.x + rect.width / 2),
      y = Math.round(rect.y + rect.height / 2);
    await ev(
      '(()=>{const e=(' +
        resize +
        ');const s=window.__historyPointer={id:null,lost:false,down:null};s.start=v=>{s.down={id:v.pointerId,target:v.target.getAttribute("aria-label"),html:v.target.outerHTML.slice(0,180),buttons:v.buttons,x:v.clientX,y:v.clientY}};s.got=v=>{s.id=v.pointerId};s.done=()=>{s.lost=true};document.addEventListener("pointerdown",s.start,true);e.addEventListener("gotpointercapture",s.got);e.addEventListener("lostpointercapture",s.done);return true})()',
    );
    try {
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({
        type: 'mouseDown',
        x,
        y,
        button: 'left',
        clickCount: 1,
        modifiers: ['leftbuttondown'],
      });
      await wait(wc, "window.__historyPointer.down?.target==='调整提交图与详情高度'");
      wc.sendInputEvent({
        type: 'mouseMove',
        x,
        y: y + 60,
        button: 'left',
        modifiers: ['leftbuttondown'],
      });
      await wait(wc, 'window.__historyPointer.id!==null');
      await wait(wc, 'Number((' + resize + ').getAttribute("aria-valuenow"))>' + beforeRatio);
      wc.sendInputEvent({ type: 'mouseUp', x, y: y + 60, button: 'left', clickCount: 1 });
      await wait(wc, 'window.__historyPointer.lost');
      const after = await geometry();
      assert.ok(after.graph > before.graph + 10);
      assert.ok(after.detail < before.detail - 10);
      assert.equal(await selectedCode(), old);
      await pass(
        ['UI-022'],
        'native pointer capture moves the real graph/detail boundary, releases cleanly and retains the selected commit and file',
        { input: 'native Electron pointer', before, after, commit: old },
      );
    } finally {
      wc.sendInputEvent({ type: 'mouseUp', x, y: y + 60, button: 'left', clickCount: 1 });
      await ev(
        '(()=>{const e=(' +
          resize +
          '),s=window.__historyPointer;document.removeEventListener("pointerdown",s.start,true);e?.removeEventListener("gotpointercapture",s.got);e?.removeEventListener("lostpointercapture",s.done);delete window.__historyPointer;return true})()',
      );
    }
  }

  await click(textButton('查看全部'));
  await wait(wc, "!document.querySelector('.commit-file-row--selected')");
  await wait(
    wc,
    "document.querySelector('.history-detail')?.textContent.includes('extra version 2')",
  );
  assert.equal(await selectedCode(), old);

  await pass(
    ['UI-022'],
    'keyboard limits change graph/detail geometry and viewing all changed files preserves the historical commit',
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
