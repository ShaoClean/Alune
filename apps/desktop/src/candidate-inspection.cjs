// A tracked file with two generations and widely separated edits lets the real
// renderer check search ranges, blame ancestry and navigation against Git.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({
  wc,
  window,
  scratchUrl,
  work,
  git,
  wait,
  element,
  button,
  textButton,
  click,
  fill,
  pass,
}) => {
  const file = 'inspect.txt',
    start = git('rev-parse', 'HEAD');
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('status', '--porcelain'), '');
  git('switch', '-qc', 'ui-inspection');
  const base = Array.from({ length: 180 }, (_, i) => 'context ' + (i + 1));
  fs.writeFileSync(path.join(work, file), base.join('\n') + '\n');
  git('add', '--', file);
  git('commit', '-qm', 'inspection before edits');
  const parent = git('rev-parse', 'HEAD');
  base[1] = 'Needle needle needlework';
  base[24] = 'changed at end';
  fs.writeFileSync(path.join(work, file), base.join('\n') + '\n');
  git('commit', '-qam', 'inspection after edits');
  const head = git('rev-parse', 'HEAD');
  await window.loadURL(scratchUrl);
  await click(button('文件'));
  const item =
    "[...document.querySelectorAll('.files-tree__item')].find(e=>e.getClientRects().length&&e.textContent.includes('inspect.txt'))";
  await click(item);
  await wait(
    wc,
    "document.querySelector('.files-code')?.textContent.includes('Needle needle needlework')",
  );
  await require('./smoke-window.cjs')(window);
  await wc.executeJavaScript(
    "new Promise(resolve=>{const e=document.querySelector('.files-code');if(e.scrollTop===200)return resolve();e.addEventListener('scroll',()=>resolve(),{once:true});e.scrollTo({top:200,behavior:'instant'});})",
  );
  await wait(wc, "document.querySelector('.files-code')?.scrollTop===200");
  await click(
    "[...document.querySelectorAll('.files-tree__item')].find(e=>e.getClientRects().length&&e.textContent.trim()==='scratch.txt')",
  );
  await wait(
    wc,
    "document.querySelector('.files-code__content')?.textContent.trimEnd()===" +
      JSON.stringify(fs.readFileSync(path.join(work, 'scratch.txt'), 'utf8').trimEnd()),
  );
  await click(item);
  await wait(
    wc,
    "document.querySelector('.files-code')?.textContent.includes('Needle needle needlework')&&document.querySelector('.files-code').scrollTop===200",
  );
  await pass(
    ['UI-008', 'UI-017'],
    'file reading position survives switching to a different real tracked file and back; restored content matches Git',
  );
  const key = async (expr, key, opts = {}) =>
    wait(
      wc,
      `(()=>{const e=(${expr});if(!e || e.disabled)return false;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key, bubbles: true, cancelable: true, ...opts })}));return true;})()`,
    );
  const search = button('查找'),
    count = (t) =>
      "document.querySelector('.find-widget__count')?.textContent===" + JSON.stringify(t);
  await key(
    element('.find-scope [tabindex]'),
    'f',
    process.platform === 'darwin' ? { metaKey: true } : { ctrlKey: true },
  );
  await fill(search, 'needle');
  await wait(wc, count('第 1 项，共 3 项'));
  const painted = () =>
    wc.executeJavaScript("Array.from(CSS.highlights.get('alune-find-match')??[],String)");
  assert.deepEqual(await painted(), ['Needle', 'needle', 'needle']);
  await click(button('全字匹配'));
  await wait(wc, count('第 1 项，共 2 项'));
  await click(button('下一个匹配项'));
  await wait(wc, count('第 2 项，共 2 项'));
  await click(button('上一个匹配项'));
  await wait(wc, count('第 1 项，共 2 项'));
  await key(search, 'Enter', { shiftKey: true });
  await wait(wc, count('第 2 项，共 2 项'));
  await click(button('大小写匹配'));
  await wait(wc, count('第 1 项，共 1 项'));
  assert.deepEqual(await painted(), ['needle']);
  await click(button('使用正则表达式'));
  await fill(search, '(');
  await wait(
    wc,
    "document.querySelector('.find-widget__error')?.textContent.includes('正则表达式无效')",
  );
  assert.deepEqual(await painted(), ['needle']);
  await fill(search, 'needle');
  await wait(wc, "!document.querySelector('.find-widget__error')");
  await click(button('关闭查找'));
  await wait(
    wc,
    "!document.querySelector('.find-widget')&&!CSS.highlights.has('alune-find-match')",
  );
  await pass(
    ['UI-018'],
    'file search: matches correspond to actual source ranges, whole-word and case filters compose, previous/next wrap, invalid regex preserves ranges, closing clears highlights',
  );

  await click(textButton('逐行追溯'));
  const owner = (n) => element('[data-blame-line="' + n + '"] .blame-row__commit');
  await wait(
    wc,
    '(' + owner(2) + ')?.getAttribute("aria-label").includes("inspection after edits")',
  );
  await click(button('追溯第 2 行到上一版本'));
  await wait(
    wc,
    '(' + owner(2) + ')?.getAttribute("aria-label").includes("inspection before edits")',
  );
  assert.ok(
    await wc.executeJavaScript(
      "document.querySelector('.blame-toolbar [title=" + JSON.stringify(parent) + "]')!==null",
    ),
  );
  const pinnedParent =
    '(' +
    owner(2) +
    ')?.getAttribute("aria-label").includes("inspection before edits")&&!!document.querySelector(' +
    JSON.stringify('.blame-toolbar [title="' + parent + '"]') +
    ')';
  const whitespace = element('.blame-toolbar label:nth-child(1) input');
  for (const checked of [true, false]) {
    await click(whitespace);
    await wait(wc, '(' + whitespace + ')?.checked===' + checked + '&&' + pinnedParent);
  }
  const ignoreFile = path.join(work, '.git-blame-ignore-revs');
  fs.writeFileSync(ignoreFile, head + '\n');
  const ignored = element('.blame-toolbar label:nth-child(2) input');
  try {
    await click(ignored);
    await wait(wc, '(' + ignored + ')?.checked===false&&' + pinnedParent);
    await click(ignored);
    await wait(
      wc,
      "document.querySelector('.blame-toolbar')?.textContent.includes('忽略提交文件已生效')&&" +
        pinnedParent,
    );
  } finally {
    fs.rmSync(ignoreFile, { force: true });
  }
  await click(ignored);
  await wait(wc, '(' + ignored + ')?.checked===false&&' + pinnedParent);
  await click(ignored);
  await wait(
    wc,
    '(' +
      ignored +
      ')?.checked===true&&' +
      pinnedParent +
      "&&!document.querySelector('.blame-toolbar')?.textContent.includes('忽略提交文件已生效')",
  );
  await click(textButton('返回工作区'));
  await wait(
    wc,
    '(' + owner(2) + ')?.getAttribute("aria-label").includes("inspection after edits")',
  );
  await click(button('追溯第 2 行到上一版本'));
  await wait(wc, pinnedParent);
  await pass(
    ['UI-004'],
    'Blame whitespace and actual ignore-file options retain the pinned parent revision; return to the worktree resolves the original HEAD',
  );
  await click(textButton('返回上一视图'));
  await wait(
    wc,
    '(' + owner(2) + ')?.getAttribute("aria-label").includes("inspection after edits")',
  );
  await require('./smoke-window.cjs')(require('electron').BrowserWindow.fromWebContents(wc));
  wc.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  await wc.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await wait(wc, '(()=>{const e=(' + owner(2) + ');if(!e)return false;e.focus();return document.activeElement===e})()');
  await wait(
    wc,
    "[...document.querySelectorAll('.blame-popover__meta code')].some(e=>e.getClientRects().length&&e.title===" +
      JSON.stringify(head) +
      ')',
  );
  await wc.executeJavaScript('document.activeElement.blur()');
  // A focus-triggered popover can also be held open by the native pointer.
  // Move off the blame block so this checks dismissal after both triggers end.
  wc.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  await wait(
    wc,
    "![...document.querySelectorAll('.blame-popover')].some(e=>e.getClientRects().length)",
  );
  await pass(
    ['UI-004'],
    'Blame focus popover resolves the actual commit hash and dismisses without changing the selected file version',
  );
  await click(owner(2));
  await wait(wc, element('.history-detail'));
  await click(button('查看提交文件 ' + file));
  await wait(
    wc,
    "document.querySelector('.history-detail .diff-shell')?.innerText.includes('Needle needle needlework')",
  );
  assert.equal(git('show', head + ':' + file).split(/\r?\n/)[1], 'Needle needle needlework');
  await click(textButton('查看全部历史', '.blame-history-scope button'));
  await wait(wc, "!document.querySelector('.blame-history-scope')");
  await wait(
    wc,
    'document.querySelector(".history-detail code[title]")?.title===' + JSON.stringify(head),
  );
  await wait(
    wc,
    "document.querySelector('.history-detail .diff-shell')?.innerText.includes('Needle needle needlework')",
  );

  await pass(
    ['UI-004', 'UI-022', 'UI-017', 'UI-072'],
    'Blame follows a changed line to its actual parent commit, returns and opens its exact historical file; leaving the scoped history preserves that commit and Diff',
  );

  await click(button('全屏查看差异'));
  await wait(wc, element('.diff-shell--fullscreen'));
  await wait(
    wc,
    "document.querySelector('.diff-change-nav__count')?.title.includes('共 2 处改动')",
  );
  await click(button('下一处改动'));
  await wait(wc, "document.querySelector('.diff-change-nav__count')?.title.includes('第 1 处')");
  await click(button('下一处改动'));
  await wait(wc, "document.querySelector('.diff-change-nav__count')?.title.includes('第 2 处')");
  await click(button('上一处改动'));
  await wait(wc, "document.querySelector('.diff-change-nav__count')?.title.includes('第 1 处')");
  await click(button('退出全屏查看'));
  await wait(wc, "!document.querySelector('.diff-shell--fullscreen')");
  await pass(
    ['UI-015', 'UI-062'],
    'fullscreen history Diff navigates between the two real changed blocks then returns to the same detail',
  );
  await click(button('关闭提交详情'));
  const filter = button('搜索提交信息或哈希');
  async function applyFilter(input, value) {
    await wc.executeJavaScript('(' + input + ').focus()');
    await fill(input, value);
    await wait(wc, '(' + input + ')?.value === ' + JSON.stringify(value));
    // Enter explicitly applies the visible draft even if an earlier filter's
    // debounce is still settling on a slower renderer.
    await key(input, 'Enter', { code: 'Enter', keyCode: 13, which: 13 });
  }
  await applyFilter(filter, head.slice(0, 10));
  await wait(
    wc,
    "[...document.querySelectorAll('.history-row__message')].map(e=>e.title).join('')==='inspection after edits'",
  );
  await applyFilter(button('按文件或目录路径筛选'), 'absent-history-file.txt');
  await wait(wc, "document.body.innerText.includes('没有符合筛选条件的提交')");
  await applyFilter(button('按文件或目录路径筛选'), file);
  await wait(
    wc,
    "document.querySelector('.history-row__message')?.title==='inspection after edits'",
  );
  await click(textButton('清除筛选'));
  await wait(
    wc,
    "[...document.querySelectorAll('.history-row__message')].some(e=>e.title==='inspection before edits')",
  );
  await pass(
    ['UI-020', 'UI-021', 'UI-022'],
    'filter the Git graph by actual commit hash, clear filters and restore the parent commit row',
  );
  git('switch', '-q', 'main');
  git('branch', '-D', 'ui-inspection');
  assert.equal(git('rev-parse', 'HEAD'), start);
  assert.equal(git('status', '--porcelain'), '');
  await window.loadURL(scratchUrl);
  await wait(wc, button('当前分支 main，切换分支'));
};
