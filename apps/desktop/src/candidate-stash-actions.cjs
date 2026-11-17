const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
module.exports = async ({ window, wc, work, git, wait, fact, pass }) => {
  const { element, button, textButton, input, pressKey } = require('./candidate-ui-driver.cjs')(wc, wait);
  const ev = (s) => wc.executeJavaScript(s),
    primary = (t) => textButton(t, '.a-dlg-actions button'),
    confirm = (t) => textButton(t, '.ant-popconfirm button');
  const click = (expr) =>
    wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(n){const progress=n.dataset.tone==='info'&&/进行中$/.test(n.querySelector('#feedback-title')?.textContent??'')&&[...n.querySelectorAll('button')].some(b=>b.textContent.replace(/\\s/g,'')==='取消操作');if(n.dataset.tone!=='success'&&!progress)throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false;}const e=(${expr});if(!e||e.disabled||e.getAttribute('aria-busy')==='true'||e.classList.contains('ant-btn-loading'))return false;e.click();return true})()`,
    );
  const tracked = path.join(work, 'scratch.txt'),
    untracked = path.join(work, 'stash-untracked-proof.txt');
  const original = fs.readFileSync(tracked),
    head = git('rev-parse', 'HEAD'),
    index = git('rev-parse', ':scratch.txt'),
    status = git('status', '--porcelain');
  assert.equal(git('stash', 'list'), '');
  assert.equal(fs.existsSync(untracked), false);
  fs.writeFileSync(untracked, 'preserve this untracked content\n');
  await click(button('刷新仓库'));
  await click(button('刷新储藏'));
  await wait(wc, textButton('储藏当前改动'));
  await click(textButton('储藏当前改动'));
  await input(element('input[placeholder="例如：设置页布局实验"]'), 'cancelled stash');
  const checkbox = element('.a-dlg-shell .dlg-check input');
  await click(checkbox);
  await wait(wc, '(' + checkbox + ')?.checked===true');
  await click(primary('取消'));
  const createField = element('input[placeholder="例如：设置页布局实验"]');
  await wait(wc, '!(' + createField + ')');
  assert.equal(git('stash', 'list'), '');
  assert.deepEqual(fs.readFileSync(tracked), original);
  assert.equal(fs.readFileSync(untracked, 'utf8'), 'preserve this untracked content\n');
  await click(textButton('储藏改动'));
  await input(element('input[placeholder="例如：设置页布局实验"]'), 'apply without pop');
  if (!(await ev('(' + checkbox + ').checked'))) await click(checkbox);
  await click(primary('创建储藏'));
  await fact(() => git('stash', 'list').includes('apply without pop'), 'stash not created');
  await wait(wc, element('.stash-card'));
  // Git and the list update before the submit promise closes its modal. Its
  // focus trap must be gone before opening the read-only preview.
  await wait(wc, '!(' + createField + ')');
  const snapshot = git('rev-parse', 'refs/stash');
  assert.equal(fs.existsSync(untracked), false);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(
    git('show', snapshot + '^3:stash-untracked-proof.txt'),
    'preserve this untracked content',
  );
  assert.equal(git('show', snapshot + ':scratch.txt'), original.toString().trim());
  await pass(
    ['UI-044'],
    'open creation from the empty state, select untracked files and cancel without changes; create the stash and verify its real tracked and untracked blobs',
  );
  await click(textButton('查看差异', '.stash-card button'));
  await wait(wc, element('[aria-label="储藏差异内容"]'));
  await wait(wc, 'document.activeElement===(' + primary('关闭') + ')');
  const diff = await ev('(' + element('[aria-label="储藏差异内容"]') + ').textContent');
  assert.ok(diff.includes('incoming fixture change'));
  const preview = element('.a-dlg-shell [aria-label="储藏差异内容"]');
  await pressKey(preview, 'Escape');
  await wait(wc, '!(' + preview + ')');
  assert.equal(git('rev-parse', 'refs/stash'), snapshot);
  assert.equal(git('status', '--porcelain'), '');
  await click(textButton('应用', '.stash-card button'));
  await fact(
    () => fs.existsSync(untracked) && fs.readFileSync(tracked).equals(original),
    'stash application did not restore both file classes',
  );
  assert.equal(git('rev-parse', 'refs/stash'), snapshot);
  assert.equal(git('rev-parse', ':scratch.txt'), index);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(fs.readFileSync(untracked, 'utf8'), 'preserve this untracked content\n');
  await pass(
    ['UI-044'],
    'Escape closes the read-only stash preview; applying restores tracked and untracked content while retaining the exact stash object and original HEAD/index',
  );
  await click(textButton('删除', '.stash-card button'));
  await click(confirm('取消'));
  assert.equal(git('rev-parse', 'refs/stash'), snapshot);
  assert.deepEqual(fs.readFileSync(tracked), original);
  await click(textButton('删除', '.stash-card button'));
  await click(confirm('删除储藏'));
  await fact(() => git('stash', 'list') === '', 'stash was not dropped');
  await wait(wc, textButton('储藏当前改动'));
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('rev-parse', ':scratch.txt'), index);
  assert.deepEqual(fs.readFileSync(tracked), original);
  assert.equal(fs.readFileSync(untracked, 'utf8'), 'preserve this untracked content\n');
  await pass(
    ['UI-044'],
    'cancel dropping a stash then confirm: the stash ref disappears, but the applied files, index and HEAD are preserved',
  );
  fs.unlinkSync(untracked);
  assert.equal(git('status', '--porcelain'), status);
  await click(button('刷新储藏'));
  const broken = path.resolve(work, git('rev-parse', '--git-path', 'refs/stash'));
  assert.equal(fs.existsSync(broken), false);
  fs.writeFileSync(broken, '3'.repeat(40) + '\n');
  try {
    const url = new URL(wc.getURL());
    url.searchParams.delete('panel');
    await window.loadURL(url.toString());
    await click(button('储藏'));
    await wait(wc, '(' + element('.workspace-panel') + ')?.innerText.includes("无法读取储藏")');
    assert.equal(git('rev-parse', 'HEAD'), head);
  } finally {
    fs.unlinkSync(broken);
  }
  await wait(
    wc,
    `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(n){const title=n.querySelector('#feedback-title')?.textContent;if(!['储藏读取失败','无法读取储藏'].includes(title))throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false;}const retry=(${textButton('重试', '.workspace-panel .text-button')});if(!retry)return false;retry.click();return true})()`,
  );
  await wait(wc, textButton('储藏当前改动'));
  assert.equal(git('stash', 'list'), '');
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('rev-parse', ':scratch.txt'), index);
  assert.deepEqual(fs.readFileSync(tracked), original);
  await pass(
    ['UI-044'],
    'a missing stash object fails the initial list without breaking repository status; remove only that test ref and explicitly retry to recover the empty stash list with HEAD, index and working bytes intact',
  );
};
