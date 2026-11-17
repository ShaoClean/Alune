// Rewrite only a disposable branch. Verify each paused commit and the final
// graph using Git independently of the displayed success state.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
module.exports = async ({
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
}) => {
  const file = 'scratch.txt',
    base = git('rev-parse', 'HEAD'),
    branch = 'ui-managed-plan';
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('status', '--porcelain'), '');
  git('switch', '-qc', branch);
  const commit = (text, title) => {
    fs.writeFileSync(path.join(work, file), text + '\n');
    git('add', '--', file);
    git('commit', '-qm', title);
    return git('rev-parse', 'HEAD');
  };
  const one = commit('first resolved', 'first rebase fixture'),
    two = commit('second resolved', 'second rebase fixture');
  await window.loadURL(scratchUrl);
  await click(button('提交历史'));
  const baseRow = element('.history-row[data-hash="' + base + '"]');
  async function startPlan() {
    await wait(
      wc,
      `(()=>{const e=(${baseRow});if(!e)return false;e.dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true}));return true})()`,
    );
    await click(
      "[...document.querySelectorAll('[role=menuitem]')].find(e=>e.getClientRects().length&&e.textContent.trim()==='从此处交互式变基')",
    );
    await wait(wc, button('第 2 个提交 second rebase fixture'));
  }
  const select = (name, action) =>
    wait(
      wc,
      `(()=>{const e=(${button(name + ' 的操作')});if(!e||e.disabled)return false;e.value=${JSON.stringify(action)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
    );
  await startPlan();
  await wait(
    wc,
    `(()=>{const h=(${button('拖动第 2 个提交')}),target=(${button('第 1 个提交 first rebase fixture')});if(!h||!target)return false;const dataTransfer=new DataTransfer();for(const [e,type] of [[h,'dragstart'],[target,'dragover'],[target,'drop'],[h,'dragend']])e.dispatchEvent(new DragEvent(type,{dataTransfer,bubbles:true,cancelable:true}));return true})()`,
  );
  await wait(wc, button('第 1 个提交 second rebase fixture'));
  await click(button('下移 second rebase fixture'));
  await wait(wc, button('第 1 个提交 first rebase fixture'));
  await select('first rebase fixture', 'drop');
  await select('first rebase fixture', 'pick');
  await click(button('上移 second rebase fixture'));
  await wait(wc, button('第 1 个提交 second rebase fixture'));
  await click(button('下移 second rebase fixture'));
  await wait(wc, button('第 2 个提交 second rebase fixture'));
  const second = button('第 2 个提交 second rebase fixture');
  await wait(
    wc,
    `(()=>{const e=(${second});if(!e)return false;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true}));return true})()`,
  );
  await select('second rebase fixture', 'reword');
  const message = button(two.slice(0, 8) + ' 提交信息');
  await fill(message, 'second replayed first');
  await click(primary('预览结果'));
  await wait(
    wc,
    '(' + element('.a-dlg-shell') + ")?.innerText.includes('second replayed first')",
  );
  await click(textButton('返回编辑'));
  await wait(wc, '(' + message + ')?.value==="second replayed first"');
  assert.equal(git('rev-parse', 'HEAD'), two);
  assert.equal(git('rev-parse', 'HEAD^'), one);
  await pass(
    ['UI-021', 'UI-024'],
    'open a rebase plan from its exact graph commit, change and undo an action, reorder by button and keyboard, edit a message, preview and return without rewriting HEAD',
  );
  await click(primary('预览结果'));
  await click(primary('执行变基'));
  await fact(
    () => git('ls-files', '-u').includes(file),
    'interactive rebase did not stop at a real conflict',
  );
  async function control(label) {
    const b = textButton(label);
    await wait(
      wc,
      `(()=>{const notice=document.querySelector('.feedback-dialog[open]');if(notice){if(notice.querySelector('#feedback-title')?.textContent==='提交历史读取失败'&&notice.innerText.includes('仓库历史已变化，请刷新提交历史后继续加载。')){const refresh=[...notice.querySelectorAll('button')].find(e=>e.textContent.trim()==='刷新历史');if(!refresh||refresh.disabled)return false;refresh.click();return false;}if(!/变基已暂停，请在冲突面板中继续处理。|Git 操作进行中/.test(notice.innerText))throw Error(notice.innerText);notice.querySelector('[aria-label="关闭提示"]').click();return false;}const e=(${b});if(!e||e.disabled||e.classList.contains('ant-btn-loading'))return false;e.click();return true;})()`,
    );
  }
  await control('跳过当前提交');
  await click(primary('取消'));
  await control('中止变基');
  await click(primary('取消'));
  assert.ok(git('ls-files', '-u').includes(file));
  assert.equal(git('rev-parse', 'main'), base);
  await control('解决冲突');
  const editor = button('冲突解决结果');
  await wait(wc, editor);
  await fill(editor, 'second resolved\n');
  await click(textButton('保存结果并暂存'));
  await fact(
    () => git('ls-files', '-u') === '' && git('show', ':' + file) === 'second resolved',
    'custom rebase resolution not staged',
  );
  await click(textButton('返回变基流程'));
  await control('继续变基');
  await fact(() => git('ls-files', '-u').includes(file), 'second reordered patch should conflict');
  await control('解决冲突');
  await click(textButton('采用传入版本并暂存'));
  await fact(
    () => git('ls-files', '-u') === '' && git('show', ':' + file) === 'first resolved',
    'incoming version not staged',
  );
  await click(textButton('返回变基流程'));
  await control('继续变基');
  await fact(
    () =>
      git('branch', '--show-current') === branch &&
      git('log', '-1', '--format=%s') === 'first rebase fixture' &&
      !fs.existsSync(path.join(work, '.git', 'alune-interactive-rebase')),
    'rebase did not finish on original branch',
  );
  assert.equal(git('log', '-2', '--format=%s'), 'first rebase fixture\nsecond replayed first');
  assert.equal(git('rev-parse', 'HEAD~2'), base);
  assert.equal(git('rev-parse', 'main'), base);
  assert.equal(fs.readFileSync(path.join(work, file), 'utf8'), 'first resolved\n');
  assert.equal(git('status', '--porcelain'), '');
  await pass(
    ['UI-024', 'UI-033', 'UI-072'],
    'cancel skip and abort, edit and stage the first conflict, choose the incoming second conflict and continue twice; verify final messages, parents and bytes',
  );
  async function paused(temporary, published) {
    git('switch', '-qc', temporary, two);
    await window.loadURL(scratchUrl);
    await click(button('提交历史'));
    await startPlan();
    await click(button('上移 second rebase fixture'));
    await click(primary('预览结果'));
    if (published) {
      await wait(wc, '(' + primary('执行变基') + ')?.disabled===true');
      await click(element('.rebase-warning input[type=checkbox]'));
    }
    await click(primary('执行变基'));
    await fact(() => git('ls-files', '-u').includes(file), 'expected reordered patch conflict');
  }
  const skipBranch = 'ui-rebase-skip',
    abortBranch = 'ui-rebase-abort';
  await paused(skipBranch, false);
  await control('跳过当前提交');
  await click(primary('确认跳过'));
  await fact(
    () => git('branch', '--show-current') === skipBranch && git('ls-files', '-u') === '' &&
      !fs.existsSync(path.join(work, '.git', 'alune-interactive-rebase')),
    'confirmed skip did not finish the plan',
  );
  assert.equal(git('rev-parse', 'HEAD^'), base);
  assert.equal(git('show', 'HEAD:' + file), 'first resolved');
  assert.equal(git('log', '-1', '--format=%s'), 'first rebase fixture');
  await pass(
    ['UI-024', 'UI-033'],
    'confirm skip on a reordered branch; only the remaining original patch is committed atop the same base',
  );
  // Publish only to this smoke test's disposable local bare origin.
  git('push', '-q', 'origin', two + ':refs/heads/ui-published-proof');
  await paused(abortBranch, true);
  await control('解决冲突');
  await fill(editor, 'abort must discard this resolution\n');
  await click(textButton('保存结果并暂存'));
  await fact(
    () => git('show', ':' + file) === 'abort must discard this resolution',
    'temporary resolution not staged',
  );
  await click(textButton('返回变基流程'));
  await control('中止变基');
  await click(primary('确认中止'));
  await fact(
    () => git('rev-parse', 'HEAD') === two && git('branch', '--show-current') === abortBranch &&
      !fs.existsSync(path.join(work, '.git', 'alune-interactive-rebase')),
    'abort did not restore original branch and commits',
  );
  assert.equal(git('rev-parse', 'HEAD^'), one);
  assert.equal(git('show', ':' + file), 'second resolved');
  assert.equal(fs.readFileSync(path.join(work, file), 'utf8'), 'second resolved\n');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('rev-parse', 'refs/remotes/origin/ui-published-proof'), two);
  await pass(
    ['UI-024', 'UI-033'],
    'a published plan requires acknowledgement; abort after staging a custom resolution restores original HEAD, index and working bytes and leaves remote ref intact',
  );
  git('push', '-q', 'origin', '--delete', 'ui-published-proof');
  git('switch', '-q', 'main');
  git('branch', '-D', branch, skipBranch, abortBranch);
  await window.loadURL(scratchUrl);
  await wait(wc, button('当前分支 main，切换分支'));
};
