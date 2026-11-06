const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, wc, work, git, wait, fact, pass }) => {
  const driver = require('./candidate-ui-driver.cjs')(wc, wait),
    { element, button, textButton, input } = driver;
  const ev = (s) => wc.executeJavaScript(s),
    primary = (s) => textButton(s, '.a-dlg-actions button'),
    confirm = (s) => textButton(s, '.ant-popconfirm button');
  const expectedNotice = `(n.dataset.tone==='info'&&/进行中$/.test(n.querySelector('#feedback-title')?.textContent??'')&&[...n.querySelectorAll('button')].some(b=>b.textContent.replace(/\\s/g,'')==='取消操作')) || (n.dataset.tone==='success'&&/已切换|已创建|已重命名|已合并|已推送标签|全部标签已推送|已从标签检出|标签已删除/.test(n.innerText))`;
  const click = (expr) =>
    wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(n){if(!(${expectedNotice}))throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false;}const e=(${expr});if(!e||e.disabled||e.getAttribute('aria-busy')==='true'||e.classList.contains('ant-btn-loading'))return false;e.click();return true})()`,
    );
  const row = (n) =>
    '[...document.querySelectorAll(".branch-row")].find(e=>e.getClientRects().length&&e.querySelector(".branch-row__name")?.textContent===' +
    JSON.stringify(n) +
    ')';
  const action = (n, label) =>
    '[...(' +
    row(n) +
    ')?.querySelectorAll("button")??[]].find(e=>e.textContent.replace(/\\s/g,"")===' +
    JSON.stringify(label.replace(/\s/g, '')) +
    ')';
  const dest = 'ui-branch-destination',
    renamed = 'ui-branch-renamed',
    source = 'ui-merge-source';
  const head = git('rev-parse', 'HEAD'),
    status = git('status', '--porcelain'),
    start = wc.getURL();
  assert.equal(git('branch', '--show-current'), 'main');
  await click(textButton('新建分支'));
  await input(element('input[placeholder="feature/my-change"]'), 'main');
  await wait(wc, '(' + primary('创建并切换') + ')?.disabled===true');
  await input(element('input[placeholder="feature/my-change"]'), dest);
  await click(primary('取消'));
  assert.equal(git('branch', '--list', dest), '');
  assert.equal(git('branch', '--show-current'), 'main');
  await click(textButton('新建分支'));
  await input(element('input[placeholder="feature/my-change"]'), dest);
  await click(primary('创建并切换'));
  await fact(() => git('branch', '--show-current') === dest, 'new branch not checked out');
  await wait(
    wc,
    'document.querySelector(".branch-pill__name")?.textContent.trim()===' + JSON.stringify(dest),
  );
  assert.equal(git('rev-parse', dest), head);
  assert.equal(git('status', '--porcelain'), status);
  git('branch', '--set-upstream-to', 'origin/main', dest);
  await click(button('刷新分支'));
  await wait(wc, '(' + row(dest) + ')?.innerText.includes("origin/main")');
  await click(button('重命名 ' + dest));
  await wait(wc, '(' + primary('重命名') + ')?.disabled===true');
  await input(button('新的分支名称'), 'main');
  await wait(wc, '(' + primary('重命名') + ')?.disabled===true');
  await input(button('新的分支名称'), renamed);
  await click(primary('取消'));
  assert.equal(git('rev-parse', dest), head);
  await click(button('重命名 ' + dest));
  await input(button('新的分支名称'), renamed);
  await click(primary('重命名'));
  await fact(() => git('branch', '--show-current') === renamed, 'active branch not renamed');
  await wait(wc, row(renamed));
  assert.equal(git('branch', '--list', dest), '');
  assert.equal(git('rev-parse', renamed), head);
  assert.equal(
    git('for-each-ref', '--format=%(upstream:short)', 'refs/heads/' + renamed),
    'origin/main',
  );
  await pass(
    ['UI-006'],
    'reject duplicate branch names and cancel without refs; create and switch, cancel renaming, then rename the active branch while preserving its commit, upstream and worktree',
  );
  const fixture = fs.mkdtempSync(path.join(path.dirname(work), 'branch-source-'));
  git('worktree', 'add', '-b', source, fixture, head);
  const there = (...args) =>
    execFileSync('git', ['-C', fixture, ...args], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(fixture, 'merge-branch-proof.txt'), 'source branch content\n');
  there('add', 'merge-branch-proof.txt');
  there('commit', '-qm', 'branch merge proof');
  const sourceHead = there('rev-parse', 'HEAD');
  git('worktree', 'remove', fixture);
  await click(button('刷新分支'));
  await wait(wc, row(source));
  await click(button('删除 ' + source));
  await click(confirm('取消'));
  assert.equal(git('rev-parse', source), sourceHead);
  await click(button('删除 ' + source));
  await click(confirm('删除分支'));
  await wait(
    wc,
    `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(!n)return false;if(${expectedNotice}){n.querySelector('[aria-label="关闭提示"]').click();return false;}if(!/not fully merged|未合并/i.test(n.innerText))throw Error(n.innerText);return true})()`,
  );
  const failure = await ev('document.querySelector(".feedback-dialog[open]").innerText');
  assert.match(failure, /not fully merged|未合并/i);
  assert.equal(git('rev-parse', source), sourceHead);
  assert.equal(git('rev-parse', renamed), head);
  await driver.click(element('.feedback-dialog[open] [aria-label="关闭提示"]'));
  await pass(
    ['UI-006'],
    'cancel branch deletion, then confirm deleting an unmerged branch: Git rejects it and both branch refs retain their original commits',
  );
  await click(action(source, '合并'));
  await click(confirm('取消'));
  assert.equal(git('rev-parse', 'HEAD'), head);
  await click(action(source, '合并'));
  await click(confirm('合并'));
  await fact(() => git('rev-parse', 'HEAD') === sourceHead, 'source branch not merged');
  assert.equal(git('branch', '--show-current'), renamed);
  assert.equal(
    fs.readFileSync(path.join(work, 'merge-branch-proof.txt'), 'utf8'),
    'source branch content\n',
  );
  assert.equal(git('rev-parse', 'main'), head);
  await click(button('删除 ' + source));
  await click(confirm('删除分支'));
  await fact(() => git('branch', '--list', source) === '', 'merged branch was not removed');
  await wait(wc, '!(' + row(source) + ')');
  assert.equal(git('rev-parse', 'HEAD'), sourceHead);
  assert.equal(git('status', '--porcelain'), status);
  await pass(
    ['UI-006'],
    'cancel merge then merge the real source commit and file into the selected branch; delete the merged source ref while preserving its commit and the untouched main branch',
  );
  await click(action(renamed, '创建 PR/MR'));
  await wait(
    wc,
    'new URLSearchParams(location.search).get("sourceBranch")===' +
      JSON.stringify(renamed) +
      '&&new URLSearchParams(location.search).get("createPr")==="1"',
  );
  assert.equal(git('rev-parse', 'HEAD'), sourceHead);
  await pass(
    ['UI-006', 'UI-072'],
    'the branch row opens PR/MR creation with its exact source branch without changing Git refs',
  );
  await window.loadURL(start);
  await click(button('分支'));
  await click(button('切换到 main'));
  await wait(wc, 'document.querySelector(".branch-pill__name")?.textContent.trim()==="main"');
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), status);
  assert.equal(fs.existsSync(path.join(work, 'merge-branch-proof.txt')), false);
};
