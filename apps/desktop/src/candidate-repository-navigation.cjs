const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, current, other, wait, pass }) => {
  await require('./smoke-window.cjs')(window);
  const wc = window.webContents,
    ev = (s) => wc.executeJavaScript(s);
  const { element, button, click, input } = require('./candidate-ui-driver.cjs')(wc, wait);
  const trigger = element('button.repository-switcher'),
    search = button('搜索已打开的仓库');
  const panel = element('.repository-switcher-panel');
  const facts = (directory) =>
    ['rev-parse HEAD', 'ls-files --stage', 'status --porcelain'].map((args) =>
      execFileSync('git', ['-C', directory, ...args.split(' ')], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    );
  const before = [facts(current.path), facts(other.path)];
  const unchanged = () => assert.deepEqual([facts(current.path), facts(other.path)], before);
  const key = async (expr, name) => {
    // A previous popup can restore focus on its last animation frame. Wait for
    // those frames, then require the native event to reach the intended node.
    await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await wait(
      wc,
      `(()=>{const e=(${expr});if(!e)return false;e.focus();return document.activeElement===e})()`,
    );
    const expected = { Up: 'ArrowUp', Down: 'ArrowDown', Return: 'Enter', Escape: 'Escape' }[name];
    await ev(
      `(()=>{const target=(${expr});window.__repositoryKeyReceipt=null;window.__repositoryKeyListener=event=>{if(event.key===${JSON.stringify(expected)})window.__repositoryKeyReceipt={matched:event.target===target,target:event.target?.outerHTML.slice(0,300)};};window.addEventListener('keydown',window.__repositoryKeyListener,true)})()`,
    );
    try {
      wc.sendInputEvent({ type: 'keyDown', keyCode: name });
      await wait(wc, '!!window.__repositoryKeyReceipt');
      const receipt = await ev('window.__repositoryKeyReceipt');
      assert.equal(
        receipt.matched,
        true,
        'native repository key target: ' + JSON.stringify(receipt),
      );
    } finally {
      wc.sendInputEvent({ type: 'keyUp', keyCode: name });
      await ev(
        "window.removeEventListener('keydown',window.__repositoryKeyListener,true);delete window.__repositoryKeyListener;delete window.__repositoryKeyReceipt",
      );
    }
  };
  const opened = async () => {
    await wait(wc, search);
    await wait(wc, 'document.activeElement===(' + search + ')');
  };
  await key(trigger, 'Up');
  await opened();
  await input(search, 'no-such-open-repository');
  await wait(wc, '(' + panel + ')?.innerText.includes("没有匹配的仓库")');
  await key(search, 'Escape');
  await wait(wc, '!(' + panel + ')&&document.activeElement===(' + trigger + ')');
  assert.equal(new URL(wc.getURL()).pathname, '/repositories/' + current.id);
  unchanged();
  await pass(
    ['UI-040', 'UI-050'],
    'native keyboard opens repository navigation, searches to an empty result and Escape closes back to its trigger without changing the active repository or either Git state',
  );

  await click(trigger);
  await opened();
  assert.equal(await ev('(' + search + ').value'), '');
  await input(search, path.basename(other.path).toUpperCase());
  await wait(
    wc,
    'document.querySelectorAll(".repository-switcher-menu__repository-item").length===1',
  );
  const item = element('.repository-switcher-menu__repository-item');
  assert.ok((await ev('(' + item + ').innerText')).includes(other.path));
  await key(search, 'Down');
  await wait(wc, '(' + item + ')?.contains(document.activeElement)');
  await key(item, 'Return');
  await wait(wc, 'location.pathname===' + JSON.stringify('/repositories/' + other.id));
  await wait(
    wc,
    'document.querySelector(".status-bar__path")?.title===' + JSON.stringify(other.path),
  );
  unchanged();
  await pass(
    ['UI-040', 'UI-050'],
    'repository search is case-insensitive and resets on reopen; native Down/Enter selects the sole exact repository and updates the status path without changing either Git state',
  );

  await click(trigger);
  await opened();
  await click(button('管理远程连接'));
  await wait(wc, 'location.pathname==="/connections"');
  await wait(wc, '!(' + panel + ')&&(' + trigger + ')?.getAttribute("aria-expanded")==="false"');
  assert.equal(await ev('!!(' + panel + ')'), false);
  unchanged();
  await pass(
    ['UI-040', 'UI-050'],
    'repository navigation opens connection management and closes its menu while retaining both registered repositories and Git states',
  );
  await click(trigger);
  await opened();
  await input(search, current.path);
  await wait(
    wc,
    'document.querySelectorAll(".repository-switcher-menu__repository-item").length===1',
  );
  await click(item);
  await wait(wc, 'location.pathname===' + JSON.stringify('/repositories/' + current.id));
  await wait(
    wc,
    'document.querySelector(".status-bar__path")?.title===' + JSON.stringify(current.path),
  );
  unchanged();
  await pass(
    ['UI-040', 'UI-050'],
    'filtering open repositories by the full canonical path and selecting its menu item returns from connections to the exact original workspace with both Git states unchanged',
  );
};
