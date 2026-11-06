const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, wc, work, bare, git, wait, fact, pass }) => {
  const { element, button, textButton, input, select } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const click = (expr) =>
    wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(n){
      if(!/已创建标签|已推送标签|全部标签已推送|已从标签检出|标签已删除|Git 操作进行中/.test(n.innerText))throw Error(n.innerText);
      const close=n.querySelector('[aria-label="关闭提示"]');if(!close)throw Error('Expected closable tag result');close.click();return false;
    }const e=(${expr});if(!e||e.disabled||e.getAttribute('aria-busy')==='true'||e.classList.contains('ant-btn-loading'))return false;e.click();return true})()`,
    );
  const ev = (s) => wc.executeJavaScript(s),
    primary = (s) => textButton(s, '.a-dlg-actions button');
  const tag = 'ui-annotated-release',
    comment = 'Release fixture\nVerified annotation body';
  const row = (n) =>
    '[...document.querySelectorAll(".tag-row")].find(e=>e.getClientRects().length&&e.querySelector("strong")?.textContent===' +
    JSON.stringify(n) +
    ')';
  const action = (n, label) =>
    '([...(' +
    row(n) +
    ')?.querySelectorAll("button")??[]].find(e=>e.textContent.replace(/\\s/g,"")===' +
    JSON.stringify(label) +
    '))';
  const snapshot = () => [
    git('rev-parse', 'HEAD'),
    git('branch', '--show-current'),
    git('status', '--porcelain'),
    git('show-ref', '--tags'),
  ];
  const base = snapshot(),
    head = base[0],
    start = wc.getURL();
  const remote = fs.mkdtempSync(path.join(path.dirname(work), 'tag-bare-'));
  execFileSync('git', ['init', '--bare', '-q', remote]);
  const target = (...args) =>
    execFileSync('git', ['--git-dir', remote, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const tags = () => target('for-each-ref', '--format=%(refname):%(objectname)', 'refs/tags');
  const originalRemote = () =>
    execFileSync(
      'git',
      ['--git-dir', bare, 'for-each-ref', '--format=%(refname):%(objectname)', 'refs/tags'],
      { encoding: 'utf8' },
    ).trim();
  const untouched = originalRemote();
  git('remote', 'add', 'tags-fixture', remote);
  await window.loadURL(start);
  await click(button('分支'));
  await wait(wc, row('p8-ui-tag'));
  await click(textButton('创建标签'));
  await input(button('标签名称'), 'p8-ui-tag');
  await wait(wc, '(' + primary('创建标签') + ')?.disabled===true');
  await input(button('标签名称'), 'invalid..tag');
  await wait(wc, '(' + primary('创建标签') + ')?.disabled===true');
  await click(primary('取消'));
  assert.deepEqual(snapshot(), base);
  await click(textButton('创建标签'));
  await input(button('标签名称'), tag);
  await wait(
    wc,
    '(()=>{const e=(' +
      element('[aria-labelledby="tag-type-label"]') +
      ')?.closest(".ant-select");if(!e)return false;e.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));return true})()',
  );
  await click(textButton('附注标签', '.ant-select-item-option'));
  await wait(wc, '(' + primary('创建标签') + ')?.disabled===true');
  await input(button('标签附注'), comment);
  await click(primary('创建标签'));
  await wait(wc, row(tag));
  await fact(
    () => git('cat-file', '-t', 'refs/tags/' + tag) === 'tag',
    'annotated tag not created',
  );
  assert.equal(git('rev-parse', tag + '^{}'), head);
  assert.equal(git('for-each-ref', '--format=%(contents)', 'refs/tags/' + tag), comment);
  await input(button('搜索标签'), 'annotation body');
  await wait(wc, 'document.querySelectorAll(".tag-row").length===1&&!!(' + row(tag) + ')');
  await click('(' + row(tag) + ').querySelector("summary")');
  await wait(wc, '(' + row(tag) + ').querySelector("details").open===true');
  await input(button('搜索标签'), head.slice(0, 12));
  await wait(wc, row(tag));
  await input(button('搜索标签'), '');
  await pass(
    ['UI-013', 'UI-045'],
    'reject duplicate and invalid tag names, cancel without changing refs, create a real annotated tag and filter by its annotation and commit hash',
  );
  await select('标签远程', 'tags-fixture');
  await wait(wc, '(' + row(tag) + ')?.innerText.includes("未推送")');
  await click(textButton('推送全部标签'));
  await click(primary('取消'));
  assert.equal(tags(), '');
  await click(textButton('推送全部标签'));
  await click(primary('推送全部标签'));
  await fact(
    () => target('rev-parse', 'refs/tags/' + tag) === git('rev-parse', 'refs/tags/' + tag),
    'tags did not reach the selected bare remote',
  );
  await wait(wc, '(' + row(tag) + ')?.innerText.includes("远程已存在")');
  assert.equal(target('rev-parse', 'refs/tags/p8-ui-tag'), head);
  assert.equal(originalRemote(), untouched);
  await pass(
    ['UI-045'],
    'cancel then confirm pushing all tags to the selected isolated remote; compare tag objects and prove the original remote is unchanged',
  );
  const beforeOfflineTag = git('rev-parse', 'refs/tags/' + tag);
  const offline = remote + '.offline';
  fs.renameSync(remote, offline);
  try {
    await click(textButton('刷新标签'));
    await wait(wc, element('.tag-error[role="status"]'));
    assert.equal(git('rev-parse', 'refs/tags/' + tag), beforeOfflineTag);
    await wait(wc, '(' + row(tag) + ')?.innerText.includes("远程状态未知")');
  } finally {
    fs.renameSync(offline, remote);
  }
  await click(textButton('重试', '.tag-error[role="status"] button'));
  await wait(wc, '(' + row(tag) + ')?.innerText.includes("远程已存在")');
  assert.equal(target('rev-parse', 'refs/tags/' + tag), beforeOfflineTag);
  await pass(
    ['UI-045'],
    'the selected remote becomes unavailable: local tag remains visible with unknown remote state; explicit retry after recovery reads the same remote object',
  );
  await click(action(tag, '检出'));
  await input(button('从标签创建的分支名称'), 'ui-tag-branch');
  await click(primary('取消'));
  assert.equal(git('branch', '--show-current'), 'main');
  await click(action(tag, '检出'));
  await input(button('从标签创建的分支名称'), 'ui-tag-branch');
  await click(primary('创建分支并切换'));
  await fact(
    () => git('branch', '--show-current') === 'ui-tag-branch',
    'tag branch checkout failed',
  );
  await wait(
    wc,
    'document.querySelector(".branch-pill__name")?.textContent.includes("ui-tag-branch")',
  );
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('rev-parse', 'main'), head);
  await click(action(tag, '检出'));
  await select('标签检出方式', '直接检出 · 游离 HEAD');
  await click(primary('确认进入游离 HEAD'));
  await fact(() => git('branch', '--show-current') === '', 'tag did not detach HEAD');
  assert.equal(git('rev-parse', 'HEAD'), head);
  await click(button('切换到 main'));
  await wait(wc, 'document.querySelector(".branch-pill__name")?.textContent.trim()==="main"');
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('status', '--porcelain'), base[2]);
  await pass(
    ['UI-045', 'UI-006'],
    'cancel tag checkout, create a branch at the tag, explicitly enter detached HEAD and switch back without changing the original branch or worktree',
  );
  await click(button('删除标签 ' + tag));
  await click(primary('取消'));
  const localObject = git('rev-parse', 'refs/tags/' + tag);
  assert.equal(target('rev-parse', 'refs/tags/' + tag), localObject);
  await click(button('删除标签 ' + tag));
  await click(primary('删除本地标签'));
  await fact(() => !git('tag', '--list', tag), 'local tag not removed');
  await wait(wc, '!(' + row(tag) + ')');
  assert.equal(target('rev-parse', 'refs/tags/' + tag), localObject);
  assert.equal(git('rev-parse', 'HEAD'), head);
  await pass(
    ['UI-045'],
    'cancel tag deletion, then remove only the local tag; the remote annotation object and commit stay intact',
  );
  // Reinstate the same object as an external change; the next confirmed operation
  // must use a newly loaded snapshot for both local and remote refs.
  git('update-ref', 'refs/tags/' + tag, localObject);
  await click(textButton('刷新标签'));
  await wait(wc, row(tag));
  await wait(wc, '(' + row(tag) + ')?.innerText.includes("远程已存在")');
  await click(button('删除标签 ' + tag));
  await click(element('.a-dlg-shell .tag-checkbox input'));
  // Advance the selected bare remote after opening the snapshot confirmation.
  // A lease failure must preserve both the new remote ref and the local tag.
  const changedRemote = git('rev-parse', 'HEAD^');
  target('update-ref', 'refs/tags/' + tag, changedRemote);
  await click(primary('删除本地与远程标签'));
  await wait(wc, primary('返回'));
  const failure = await ev(
    "[...document.querySelectorAll('.a-dlg-shell')].find(e=>e.getClientRects().length&&e.querySelector('.feedback-description'))?.innerText",
  );
  assert.match(failure, /stale info|rejected/i);
  assert.equal(target('rev-parse', 'refs/tags/' + tag), changedRemote);
  assert.equal(git('rev-parse', 'refs/tags/' + tag), localObject);
  await click(primary('返回'));
  await click(primary('取消'));
  await click(textButton('刷新标签'));
  await wait(wc, '(' + row(tag) + ')?.innerText.includes("远程同名标签不同")');
  await pass(
    ['UI-045'],
    'a remote tag changed after confirmation opened: the lease rejects deletion, both refs remain intact and refreshing reports the conflicting object',
  );
  await click(button('删除标签 ' + tag));
  await click(element('.a-dlg-shell .tag-checkbox input'));
  await wait(
    wc,
    "[...document.querySelectorAll('.a-dlg-shell .tag-error')].some(e=>e.getClientRects().length&&e.innerText.includes('远程同名标签指向不同对象'))",
  );
  await click(primary('删除本地与远程标签'));
  await fact(
    () => !git('tag', '--list', tag) && !tags().includes('refs/tags/' + tag + ':'),
    'confirmed deletion left a tag ref',
  );
  await wait(wc, '!(' + row(tag) + ')');
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(originalRemote(), untouched);
  await pass(
    ['UI-045'],
    're-read an externally restored tag then confirm local and remote deletion; both refs disappear while HEAD and the other remote remain intact',
  );
  await select('标签远程', 'origin');
  await wait(wc, '(' + row('p8-ui-tag') + ')?.innerText.includes("远程已存在")');
  git('remote', 'remove', 'tags-fixture');
};
