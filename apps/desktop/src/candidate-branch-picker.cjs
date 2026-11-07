// Exercise the toolbar's own callbacks, including pointer focus and its shared
// branch dialog; compare Git facts instead of treating a closed popup as success.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, repo, wait, pass }) => {
  const wc = window.webContents,
    ev = (code) => wc.executeJavaScript(code);
  const { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const branch = git('branch', '--show-current'),
    head = git('rev-parse', 'HEAD');
  const refs = git('show-ref');
  const snapshot = () => ({
    head: git('rev-parse', 'HEAD'),
    index: git('ls-files', '--stage'),
    status: git('status', '--porcelain=v1'),
    files: Object.fromEntries(
      ['candidate.txt', 'unstaged.txt'].map((name) => [
        name,
        fs.readFileSync(path.join(repo, name), 'hex'),
      ]),
    ),
  });
  const before = snapshot(),
    original = wc.getURL(),
    name = 'p9-picker-created';
  const pill = () => button('当前分支 ' + git('branch', '--show-current') + '，切换分支');
  const search = button('筛选分支');
  const field = element('input[placeholder="feature/my-change"]');
  const primary = textButton('创建并切换', '.a-dlg-actions button');
  const open = async () => {
    await click(pill());
    await wait(wc, search);
    await wait(wc, 'document.activeElement===(' + search + ')');
    await wait(wc, '!(' + element('.branch-picker [role=status]') + ')');
  };
  const pointer = async (expr) => {
    const point = await ev(
      'new Promise((resolve,reject)=>{let previous,stable=0;const end=Date.now()+5000;function frame(){const node=(' +
        expr +
        ');if(!node)return reject(Error("Missing pointer target"));const r=node.getBoundingClientRect(),p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};const hit=node.contains(document.elementFromPoint(p.x,p.y));stable=hit&&JSON.stringify(p)===previous?stable+1:0;previous=JSON.stringify(p);if(stable>=3)return resolve(p);if(Date.now()>end)return reject(Error("Pointer target never settled"));requestAnimationFrame(frame)}frame()})',
    );
    wc.sendInputEvent({ type: 'mouseMove', ...point });
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  };
  await open();
  const current = element('[role=option][aria-current=true]');
  await pointer(current);
  await wait(wc, 'document.activeElement===(' + search + ')');
  assert.equal(git('branch', '--show-current'), branch);
  assert.deepEqual(snapshot(), before);
  await click(textButton('新建分支…', '.branch-picker button'));
  await wait(wc, field);
  await input(field, 'p9-picker-cancelled');
  await click(textButton('取消', '.a-dlg-actions button'));
  await wait(wc, '!(' + field + ')');
  assert.equal(git('branch', '--list', 'p9-picker-cancelled'), '');
  assert.equal(git('show-ref'), refs);
  assert.deepEqual(snapshot(), before);
  await pass(
    ['UI-005', 'UI-006'],
    'pointer selection of the current branch keeps filter focus and all Git facts; cancelling toolbar branch creation writes no ref',
  );

  await open();
  await click(textButton('新建分支…', '.branch-picker button'));
  await wait(wc, field);
  assert.equal(await ev('(' + field + ').value'), '');
  assert.equal(await ev('(' + primary + ').disabled'), true);
  await input(field, branch);
  await wait(wc, 'document.body.innerText.includes("已存在同名本地分支")');
  assert.equal(await ev('(' + primary + ').disabled'), true);
  assert.equal(git('show-ref'), refs);
  await input(field, name);
  await click(primary);
  await wait(wc, button('当前分支 ' + name + '，切换分支'));
  assert.equal(git('branch', '--show-current'), name);
  assert.equal(git('rev-parse', name), head);
  assert.deepEqual(snapshot(), before);
  await pass(
    ['UI-005', 'UI-006'],
    'toolbar branch dialog resets cancelled drafts, blocks empty/duplicate names, then creates and checks out exactly the requested ref while retaining staged and unstaged bytes',
  );

  await open();
  await input(search, branch);
  const target = element('[role=option][aria-label="切换到 ' + branch + '"]');
  await wait(wc, target);
  await pointer(target);
  await wait(wc, button('当前分支 ' + branch + '，切换分支'));
  await wait(wc, 'document.activeElement===(' + button('当前分支 ' + branch + '，切换分支') + ')');
  assert.equal(git('branch', '--show-current'), branch);
  assert.deepEqual(snapshot(), before);
  await pass(
    ['UI-005'],
    'native pointer chooses a filtered branch, switches real Git back and returns focus to its toolbar trigger without altering index or working bytes',
  );

  await open();
  assert.equal(await ev('(' + search + ').value'), '');
  await click(textButton('创建 PR/MR…', '.branch-picker button'));
  await wait(wc, 'new URLSearchParams(location.search).get("panel")==="pull-requests"');
  const query = new URL(await ev('location.href')).searchParams;
  assert.equal(query.get('createPr'), '1');
  assert.equal(query.get('sourceBranch'), branch);
  assert.deepEqual(snapshot(), before);
  await pass(
    ['UI-005', 'UI-011'],
    'toolbar PR/MR entry carries the exact current source branch into the review route and leaves Git unchanged',
  );
  await window.loadURL(original);
  await wait(wc, button('当前分支 ' + branch + '，切换分支'));
  git('branch', '-d', name);
  assert.equal(git('show-ref'), refs);
};
