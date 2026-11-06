const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process');
module.exports = async ({
  wc,
  window,
  origin,
  repo,
  id,
  wait,
  element,
  button,
  textButton,
  click,
  text,
  pass,
}) => {
  const scratch = fs.mkdtempSync(path.join(path.dirname(repo), 'p8-actions-')),
    bare = path.join(scratch, 'remote.git'),
    work = path.join(scratch, 'actions');
  fs.mkdirSync(work);
  const git = (...args) =>
    execFileSync('git', ['-C', work, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-qb', 'main');
  git('config', 'user.name', 'UI fixture');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(work, 'scratch.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  execFileSync('git', ['init', '--bare', '-q', bare]);
  git('remote', 'add', 'origin', bare);
  git('push', '-qu', 'origin', 'main');
  fs.writeFileSync(path.join(work, 'scratch.txt'), 'incoming fixture change\n');
  const primary = (label) =>
      "[...document.querySelectorAll('.a-dlg-actions button')].filter(b=>b.getClientRects().length && !b.closest('[inert]')).find(b=>b.textContent.replace(/\\s/g,'')===" +
      JSON.stringify(label.replace(/\s/g, '')) +
      ')',
    fill = async (expr, value) => {
      await wait(
        wc,
        `(()=>{const node=(${expr});if(!node||node.disabled||node.readOnly)return false;
        const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${JSON.stringify(value)});
        node.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      );
    };
  async function fact(check, message) {
    const until = Date.now() + 15000;
    let cause;
    while (Date.now() < until) {
      try {
        if (check()) return;
      } catch (e) {
        cause = e;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    const feedback = await wc.executeJavaScript(
      "JSON.stringify({dialog:document.querySelector('.feedback-dialog[open]')?.innerText,errors:[...document.querySelectorAll('[role=alert]')].filter(e=>e.getClientRects().length).map(e=>e.innerText).slice(0,3),current:location.pathname})",
    );
    throw Error(message + ' | ' + feedback, { cause });
  }
  await window.loadURL(origin + '/repositories');
  await click(button('打开本地仓库'));
  await fill(element('#local-repo-path'), work);
  await click(textButton('检查仓库'));
  await click(primary('打开工作区'));
  await wait(wc, button('暂存 scratch.txt'));
  await pass(
    ['UI-028', 'UI-040', 'UI-070', 'UI-072'],
    'register a separate repository by absolute path, inspect then open its workspace',
  );
  await click(button('储藏'));
  await click(textButton('储藏改动'));
  await fill(element('input[placeholder="例如：设置页布局实验"]'), 'workbench-stash');
  await click(primary('创建储藏'));
  await wait(wc, text('workbench-stash'));
  await fact(() => git('stash', 'list').includes('workbench-stash'), 'missing Git stash');
  assert.equal(fs.readFileSync(path.join(work, 'scratch.txt'), 'utf8'), 'base\n');
  await click(textButton('查看差异'));
  await wait(wc, element('[aria-label="储藏差异内容"]'));
  assert.ok(
    await wc.executeJavaScript(
      "document.querySelector('[aria-label=储藏差异内容]').innerText.includes('incoming fixture change')",
    ),
  );
  await click(textButton('关闭'));
  await click(textButton('弹出'));
  await fact(() => git('stash', 'list') === '', 'stash still exists');
  assert.equal(
    fs.readFileSync(path.join(work, 'scratch.txt'), 'utf8'),
    'incoming fixture change\n',
  );
  await pass(
    ['UI-044', 'UI-072'],
    'stash create, preview and pop restore original bytes without an extra stash entry',
  );
  await require('./candidate-stash-actions.cjs')({ window, wc, work, git, wait, fact, pass });
  await click(element('button[aria-label^="改动"]'));
  await click(button('暂存 scratch.txt'));
  await wait(wc, button('取消暂存 scratch.txt'));
  await fill(button('提交摘要'), 'commit from actual UI');
  await fill(button('提交描述'), 'body saved');
  await click(textButton('提交已暂存内容 · 1'));
  await fact(
    () => git('log', '-1', '--format=%s') === 'commit from actual UI',
    'commit did not reach HEAD',
  );
  // The store may still be refreshing after Git has written HEAD. Await
  // the UI's own post-commit state, then amend the populated HEAD snapshot.
  await wait(wc, text('0 个文件已暂存'));
  await click(textButton('修改上一次提交'));
  await wait(
    wc,
    "document.querySelector('[aria-label=修改后的提交信息]')?.value.includes('commit from actual UI')",
  );
  await fill(button('修改后的提交信息'), 'amended from actual UI');
  await wait(
    wc,
    "document.querySelector('[aria-label=修改后的提交信息]').value==='amended from actual UI'",
  );
  await click(textButton('确认修改提交'));
  await fact(
    () => git('log', '-1', '--format=%s') === 'amended from actual UI',
    'amend did not update HEAD',
  );
  assert.equal(git('rev-list', '--count', 'HEAD'), '2');
  await pass(
    ['UI-003', 'UI-007'],
    'commit through workbench then amend HEAD without an extra commit',
  );
  await click(button('分支'));
  await click(textButton('创建标签'));
  await fill(button('标签名称'), 'p8-ui-tag');
  const tagConfirm =
    "[...document.querySelectorAll('.a-dlg-actions button')].find(b=>b.getClientRects().length && b.textContent.trim()==='创建标签')";
  await click(tagConfirm);
  try {
    await wait(wc, text('p8-ui-tag'));
  } catch (e) {
    throw Error(
      'Tag creation failed: refs=' +
        git('tag', '--list') +
        ' dialog=' +
        (await wc.executeJavaScript(
          "JSON.stringify({value:document.querySelector('[aria-label=标签名称]')?.value,dialog:document.querySelector('.a-dlg-shell')?.innerText,feedback:document.querySelector('.feedback-dialog[open]')?.innerText})",
        )),
      { cause: e },
    );
  }
  assert.equal(git('rev-parse', 'p8-ui-tag'), git('rev-parse', 'HEAD'));
  const tagPush =
    "[...document.querySelectorAll('.tag-row')].find(e=>e.innerText.includes('p8-ui-tag')) && [...[...document.querySelectorAll('.tag-row')].find(e=>e.innerText.includes('p8-ui-tag')).querySelectorAll('button')].find(e=>e.textContent.replace(/\\s/g,'')==='推送')";
  await click(tagPush);
  await fact(
    () => git('ls-remote', '--tags', 'origin').includes('refs/tags/p8-ui-tag'),
    'tag never reached bare remote',
  );
  await wait(
    wc,
    "[...document.querySelectorAll('.tag-row')].some(e=>e.innerText.includes('p8-ui-tag')&&e.innerText.includes('远程已存在'))",
  );
  await fill(button('搜索标签'), 'absent-tag');
  await wait(wc, text('没有匹配的标签'));
  await fill(button('搜索标签'), '');
  await pass(
    ['UI-013', 'UI-045'],
    'create a tag at HEAD, push only to a disposable bare repository and filter tags',
  );
  await require('./candidate-tag-actions.cjs')({ window, wc, work, bare, git, wait, fact, pass });
  await require('./candidate-branch-actions.cjs')({ window, wc, work, git, wait, fact, pass });
  await require('./candidate-context-actions.cjs')({ window, wc, work, wait, fact, pass });
  await click(button('远程'));
  await click(textButton('添加远程'));
  await fill(element('#remote-name'), 'local-backup');
  await fill(element('#remote-url'), bare);
  await wait(
    wc,
    "document.querySelector('#remote-name')?.value==='local-backup'&&document.querySelector('#remote-url')?.value===" +
      JSON.stringify(bare),
  );
  await click(primary('添加远程'));
  await wait(
    wc,
    "[...document.querySelectorAll('.remote-card')].some(e=>e.innerText.includes('local-backup'))",
  );
  await fact(() => git('remote').split(/\r?\n/).includes('local-backup'), 'remote not added');
  assert.equal(git('remote', 'get-url', 'local-backup'), bare);
  await pass(
    ['UI-034'],
    'add a named local remote and verify its address in the actual Git config',
  );

  await require('./candidate-remote-actions.cjs')({ window, wc, work, git, wait, fact, pass });
  // Build an actual conflict outside the UI, resolve one hunk in the workspace
  // and require both the selected bytes and two Git parents on completion.
  git('checkout', '-qb', 'incoming');
  fs.writeFileSync(path.join(work, 'scratch.txt'), 'incoming side\n');
  git('commit', '-qam', 'incoming side');
  const otherHead = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(work, 'scratch.txt'), 'current side\n');
  git('commit', '-qam', 'current side');
  const mainHead = git('rev-parse', 'HEAD');
  assert.throws(() => git('merge', '--no-edit', 'incoming'));
  assert.ok(git('ls-files', '-u').includes('scratch.txt'));
  const scratchUrl = wc.getURL();
  await window.loadURL(scratchUrl);
  await click(element('button[aria-label^="改动"]'));
  await click(button('刷新仓库'));
  await wait(wc, text('仍有冲突'));
  await click(element('button[aria-label^="查看差异 scratch.txt"]'));
  await click(button('冲突 1：采用传入'));
  await fact(
    () => fs.readFileSync(path.join(work, 'scratch.txt'), 'utf8') === 'incoming side\n',
    'hunk did not change',
  );
  await click(textButton('标记为已解决'));
  await wait(wc, text('冲突已全部解决'));
  await click(textButton('继续合并'));
  await fact(() => !fs.existsSync(path.join(work, '.git', 'MERGE_HEAD')), 'merge did not finish');
  assert.equal(git('log', '-1', '--format=%P'), mainHead + ' ' + otherHead);
  assert.equal(git('show', 'HEAD:scratch.txt'), 'incoming side');
  const verifiedHead = git('rev-parse', 'HEAD');
  await pass(
    ['UI-010', 'UI-011', 'UI-007'],
    'resolve an actual Git merge hunk, stage the chosen side, continue and verify both parents and committed bytes',
  );

  await require('./candidate-file-actions.cjs')({
    wc,
    work,
    git,
    wait,
    fact,
    button,
    element,
    click,
    fill,
    primary,
    textButton,
    pass,
  });

  await require('./candidate-inspection.cjs')({
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
  });

  await require('./candidate-history-actions.cjs')({ window, wc, work, wait, pass });
  await require('./candidate-rebase-actions.cjs')({
    wc,
    window,
    scratchUrl,
    work,
    git,
    wait,
    fact,
    element,
    button,
    textButton,
    click,
    fill,
    primary,
    pass,
  });

  await require('./candidate-terminal-actions.cjs')({
    wc,
    work,
    wait,
    fact,
    element,
    button,
    click,
    primary,
    pass,
  });

  await require('./candidate-toolbar-actions.cjs')({
    wc,
    window,
    scratchUrl,
    work,
    bare,
    git,
    wait,
    fact,
    element,
    button,
    textButton,
    click,
    fill,
    primary,
    pass,
  });

  // The target directory lives entirely inside this test root.
  await click(button('查看关联 Worktrees'));
  await click(button('新建本地 Worktree'));
  const linked = path.join(scratch, 'linked');
  await fill(element('#worktree-path'), linked);
  await fill(element('#worktree-branch'), 'ui-linked');
  await click(textButton('创建并打开'));
  await fact(() => fs.existsSync(path.join(linked, '.git')), 'linked worktree was not created');
  await wait(wc, "document.querySelector('.branch-pill__name')?.textContent.trim()==='ui-linked'");
  assert.equal(
    execFileSync('git', ['-C', linked, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    verifiedHead,
  );
  await require('./candidate-worktree-actions.cjs')({
    window,
    wc,
    scratchUrl,
    linked,
    git,
    wait,
    fact,
    pass,
  });
  await require('./candidate-sidebar-actions.cjs')({
    window,
    wc,
    origin,
    original: id,
    linked: new URL(wc.getURL()).pathname.split('/').at(-1),
    linkedPath: linked,
    wait,
    pass,
  });
  await require('./candidate-tab-actions.cjs')({
    window,
    wc,
    origin,
    original: id,
    scratch: new URL(scratchUrl).pathname.split('/').at(-1),
    linked: new URL(wc.getURL()).pathname.split('/').at(-1),
    linkedPath: linked,
    wait,
    pass,
  });
  await window.loadURL(scratchUrl);
  await click(button('查看关联 Worktrees'));
  await wait(wc, text('ui-linked'));
  await pass(
    ['UI-052', 'UI-053', 'UI-041'],
    'create and open a linked Worktree; switching back lists both real registrations at the same commit',
  );
  await window.loadURL(origin + '/repositories');
  await click(button('删除 actions'));
  await click(textButton('移除登记'));
  await wait(wc, '!(' + button('删除 actions') + ')');
  assert.equal(git('rev-parse', 'HEAD'), verifiedHead);
  assert.equal(git('status', '--porcelain'), '');
  await pass(
    ['UI-002', 'UI-049', 'UI-070'],
    'remove only the workspace registration, preserving the Git directory, index and HEAD',
  );
  await window.loadURL(origin + '/repositories/' + id);
  await wait(wc, button('取消暂存 candidate.txt'));
};
