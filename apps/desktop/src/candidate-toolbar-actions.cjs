// Exercise push/pull/fetch and confirmation through the toolbar. All remote
// refs in this file belong to a bare repository inside this test's temp root.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process');
module.exports = async ({
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
}) => {
  const branch = 'ui-toolbar-sync',
    tag = 'ui-toolbar-tag',
    marker = 'ui-toolbar-fetch',
    base = git('rev-parse', 'HEAD');
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(fs.realpathSync(git('remote', 'get-url', 'origin')), fs.realpathSync(bare));
  const origin = (...args) =>
    execFileSync('git', ['--git-dir', bare, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('switch', '-qc', branch);
  git('push', '-qu', 'origin', branch);
  fs.writeFileSync(path.join(work, 'toolbar.txt'), 'work from toolbar\n');
  git('add', '--', 'toolbar.txt');
  git('commit', '-qm', 'toolbar ahead');
  let tip = git('rev-parse', 'HEAD');
  await window.loadURL(scratchUrl);
  await wait(wc, button('当前分支 ' + branch + '，切换分支'));
  const key = (x, key) =>
    wait(
      wc,
      `(()=>{const e=(${x});if(!e||e.disabled)return false;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key, bubbles: true, cancelable: true })}));return true;})()`,
    );
  const changes = element('[aria-label="仓库视图"] button[aria-label^="改动"]');
  await click(changes);
  await key(changes, 'End');
  await wait(wc, "document.activeElement.getAttribute('aria-label')==='PR/MR'");
  await key(button('PR/MR'), 'Home');
  await wait(wc, "document.activeElement.getAttribute('aria-label')?.startsWith('改动')");
  await key(changes, 'ArrowRight');
  await wait(wc, "document.activeElement.getAttribute('aria-label')==='文件'");
  await click(button('文件'));
  await wait(
    wc,
    "[...document.querySelectorAll('.files-tree__item')].some(e=>e.getClientRects().length&&e.textContent.includes('toolbar.txt'))",
  );
  await click(button('提交签名设置'));
  await wait(wc, '(' + element('.a-dlg-shell') + ")?.innerText.includes('在本机签名')");
  const scheme = element('[aria-labelledby="signing-format"]');
  await wait(
    wc,
    `(()=>{const e=(${scheme})?.closest('.ant-select');if(!e)return false;e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`,
  );
  await click(textButton('SSH', '.ant-select-item-option'));
  await fill(button('签名密钥'), 'local-fixture-key');
  await click(primary('保存到此仓库'));
  await fact(
    () =>
      git('config', '--get', 'user.signingkey') === 'local-fixture-key' &&
      git('config', '--get', 'gpg.format') === 'ssh',
    'signing key and format were not saved in local Git config',
  );
  assert.equal(git('config', '--get', 'gpg.format'), 'ssh');
  assert.equal(git('config', '--get', 'commit.gpgSign'), 'false');
  await wait(wc, '!(' + primary('保存到此仓库') + ')');
  await click(button('提交签名设置'));
  await wait(wc, '(' + button('签名密钥') + ')?.value==="local-fixture-key"');
  await click(primary('取消'));
  await pass(
    ['UI-042', 'UI-043', 'UI-072'],
    'keyboard navigation inside the view toolbar opens actual tracked files; signing dialog saves and reloads the SSH key reference on the local execution host',
  );
  await click(button('推送'));
  await fact(
    () => origin('rev-parse', branch) === tip,
    'primary push did not reach fixture upstream',
  );
  async function menu(label, keyboard = false) {
    const toggle = button('更多推送选项');
    await wait(
      wc,
      '(' +
        toggle +
        ')?.getAttribute("aria-disabled")!=="true"&&(' +
        toggle +
        ')?.disabled===false',
    );
    if (keyboard) await key(toggle, 'ArrowDown');
    else await click(toggle);
    // Ant appends the live ahead-count after the push label.
    const item = `[...document.querySelectorAll('#repository-push-menu [role=menuitem]')].find(e=>e.getClientRects().length&&!e.closest('[inert]')&&e.textContent.trim().startsWith(${JSON.stringify(label)}))`;
    await wait(wc, item);
    return item;
  }
  const firstPushed = tip;
  git('commit', '--allow-empty', '-qm', 'toolbar menu push');
  tip = git('rev-parse', 'HEAD');
  await click(await menu('推送到上游'));
  await fact(() => origin('rev-parse', branch) === tip, 'menu push did not reach the upstream');
  assert.equal(origin('rev-parse', branch + '^'), firstPushed);
  let item = await menu('获取远程更新', true);
  await key(item, 'Escape');
  await wait(wc, '!(' + item + ')');
  origin('update-ref', 'refs/heads/' + marker, base);
  item = await menu('获取远程更新');
  await click(item);
  await fact(
    () => git('rev-parse', 'refs/remotes/origin/' + marker) === base,
    'fetch did not discover ref',
  );
  git('tag', tag, tip);
  item = await menu('推送标签');
  await click(item);
  await fact(
    () => origin('rev-parse', 'refs/tags/' + tag) === tip,
    'toolbar tag push did not reach remote',
  );
  const incoming = git(
    'commit-tree',
    git('rev-parse', 'HEAD^{tree}'),
    '-p',
    tip,
    '-m',
    'incoming toolbar',
  );
  git('push', '-q', 'origin', incoming + ':refs/heads/' + branch);
  await click(button('拉取'));
  await fact(() => git('rev-parse', 'HEAD') === incoming, 'toolbar pull did not fast forward');
  assert.equal(git('rev-parse', 'HEAD^'), tip);
  await pass(
    ['UI-042', 'UI-072'],
    'push a branch, dismiss the keyboard push menu, fetch a new remote ref, push a tag and pull an incoming commit; verify local and bare refs independently',
  );
  git('reset', '--hard', tip);
  git('commit', '--allow-empty', '-qm', 'rewritten local');
  const replacement = git('rev-parse', 'HEAD');
  async function confirmDialog() {
    const item = await menu('强制推送（含租约）…');
    await click(item);
    await wait(wc, '(' + primary('确认强制推送') + ')?.disabled===true');
  }
  await confirmDialog();
  await click(primary('取消'));
  await wait(wc, '!(' + primary('确认强制推送') + ')');
  assert.equal(origin('rev-parse', branch), incoming);
  await confirmDialog();
  const confirm = element('.a-dlg-shell input[placeholder="' + branch + '"]');
  await fill(confirm, 'wrong-branch');
  await wait(wc, '(' + primary('确认强制推送') + ')?.disabled===true');
  await fill(confirm, branch);
  await click(primary('确认强制推送'));
  await fact(
    () =>
      origin('rev-parse', branch) === replacement &&
      git('rev-parse', 'refs/remotes/origin/' + branch) === replacement,
    'confirmed lease push did not update both the isolated upstream and its local tracking ref',
  );
  assert.equal(git('rev-parse', 'main'), base);
  await pass(
    ['UI-042', 'UI-072'],
    'cancel a force-with-lease operation, reject the wrong branch name, then explicitly confirm the correct name and verify the new upstream object',
  );
  const http = require('node:http');
  let started = 0,
    closed = 0;
  const server = http.createServer((req, res) => {
    started++;
    res.on('close', () => closed++);
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  try {
    git('remote', 'set-url', 'origin', 'http://127.0.0.1:' + server.address().port + '/held.git');
    const snapshot = [
      git('rev-parse', 'HEAD'),
      git('ls-files', '--stage'),
      git('status', '--porcelain'),
    ];
    await click(button('拉取'));
    await fact(() => started > 0, 'Git pull did not reach the held loopback peer');
    // While syncing the primary control is busy but remains a valid cancel
    // button; do not suppress this click as a duplicate write.
    await wait(
      wc,
      `(()=>{const e=(${button('取消拉取')});if(!e||e.disabled||e.getAttribute('aria-disabled')==='true')return false;e.click();return true})()`,
    );
    await fact(() => closed > 0, 'cancel did not close the real Git HTTP request');
    await wait(wc, '(' + button('拉取') + ')?.getAttribute("aria-disabled")==="false"');
    assert.deepEqual(
      [git('rev-parse', 'HEAD'), git('ls-files', '--stage'), git('status', '--porcelain')],
      snapshot,
    );
    await pass(
      ['UI-042', 'UI-072'],
      'cancel from the toolbar while a real pull is waiting for its loopback remote; connection closes, original control returns and refs, index and working bytes are unchanged',
    );
  } finally {
    git('remote', 'set-url', 'origin', bare);
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
  git('switch', '-q', 'main');
  git('branch', '-D', branch);
  git('tag', '-d', tag);
  git('push', '-q', 'origin', '--delete', branch, marker, tag);
  git('config', '--unset-all', 'user.signingkey');
  git('config', '--unset-all', 'gpg.format');
  assert.equal(git('status', '--porcelain'), '');
  await window.loadURL(scratchUrl);
  await wait(wc, button('当前分支 main，切换分支'));
};
