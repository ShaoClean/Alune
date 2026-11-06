// Compare the live tabs to the session saved by the real preload. Closing a
// tab must not unregister a repo or delete its worktree.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
module.exports = async ({
  window,
  wc,
  origin,
  original,
  scratch,
  linked,
  linkedPath,
  wait,
  pass,
}) => {
  const { element, button, textButton, click } = require('./candidate-ui-driver.cjs')(wc, wait);
  const ev = (s) => wc.executeJavaScript(s),
    selector = (id) => '[data-repository-tab="' + id + '"]',
    wrap = (id) => element(selector(id)),
    handle = (id) => element(selector(id) + ' .repository-tab__select');
  const tabList = element('[role=tablist][aria-label="已打开的仓库标签页"]');
  const dom =
    '[...document.querySelectorAll("[data-repository-tab]")].map(t=>t.dataset.repositoryTab)';
  const disk = async () =>
    JSON.parse(await ev('window.aluneWorkspace.load()')).state.repositorySession;
  async function check(ids, active) {
    const route = active ? '/repositories/' + active : '/repositories';
    const selected =
      "document.querySelector('[data-repository-tab] [role=tab][aria-selected=true]')?.closest('[data-repository-tab]')?.dataset.repositoryTab??null";
    try {
      await wait(
        wc,
        'JSON.stringify(' +
          dom +
          ')===' +
          JSON.stringify(JSON.stringify(ids)) +
          '&&location.pathname===' +
          JSON.stringify(route) +
          '&&(' +
          selected +
          ')===' +
          JSON.stringify(active),
      );
    } catch (error) {
      throw new Error(
        'Tab transition: ' +
          JSON.stringify({
            expected: { route, ids, active },
            rendered: await ev(
              '({route:location.pathname,ids:' + dom + ',active:' + selected + '})',
            ),
            saved: await disk(),
          }),
        { cause: error },
      );
    }
    const end = Date.now() + 12000;
    let last;
    do {
      last = await disk();
      if (last.activeId === active && JSON.stringify(last.ids) === JSON.stringify(ids)) return;
      await new Promise((ok) => setTimeout(ok, 35));
    } while (Date.now() < end);
    assert.deepEqual(last, { ids, activeId: active });
  }
  const keys = (expr, key, rest = {}) =>
    wait(
      wc,
      `(()=>{const e=(${expr});if(!e||e.disabled)return false;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key, bubbles: true, cancelable: true, ...rest })}));return true})()`,
    );
  const closeCommand = (label, count) => button(label + '，将关闭 ' + count + ' 个标签页');
  const menu = (id, keyboard = false) =>
    keyboard
      ? keys(handle(id), 'F10', { shiftKey: true })
      : wait(
          wc,
          `(()=>{const e=(${wrap(id)});if(!e)return false;const rect=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:rect.left+8,clientY:rect.top+3}));return true})()`,
        );
  await require('./smoke-window.cjs')(window);
  await check([original, scratch, linked], linked);
  const detail = element('.repository-identity-details__path');
  await ev('(' + handle(linked) + ').focus()');
  await wait(wc, detail);
  assert.equal(
    (await ev('(' + detail + ').textContent')).replaceAll('\\', '/'),
    fs.realpathSync.native(linkedPath).replaceAll('\\', '/'),
  );
  await keys(handle(linked), 'Escape');
  await wait(wc, '!(' + detail + ')');
  await ev('document.activeElement.blur()');
  await ev('(' + handle(linked) + ').focus()');
  await wait(wc, detail);
  await click(handle(linked));
  await wait(wc, '!(' + detail + ')');
  await check([original, scratch, linked], linked);
  await pass(
    ['UI-038', 'UI-041'],
    'repository identity tooltip shows the canonical linked-worktree path; Escape and selecting the tab dismiss it without changing order or ownership',
  );
  // Two actions in one renderer task expose a router transition that has
  // not yet committed. A closing tab must not reopen on that obsolete URL.
  await wait(
    wc,
    `(()=>{const pick=(${handle(original)}),close=(${element(selector(original) + ' .repository-tab__close')});if(!pick||!close)return false;pick.click();close.click();return true})()`,
  );
  await check([scratch, linked], scratch);
  await window.loadURL(origin + '/repositories/' + original);
  await check([scratch, linked, original], original);
  await keys(handle(original), 'ArrowLeft', { altKey: true });
  await check([scratch, original, linked], original);
  await keys(handle(original), 'ArrowLeft', { altKey: true });
  await check([original, scratch, linked], original);
  await pass(
    ['UI-041', 'UI-025'],
    'select and immediately close the newly selected tab; navigate to the surviving neighbor and never reopen the closed registration',
  );

  await click(handle(original));
  await check([original, scratch, linked], original);
  await keys(handle(original), 'ArrowRight', { altKey: true });
  await check([scratch, original, linked], original);
  await window.loadURL(origin + '/');
  await check([scratch, original, linked], original);
  await pass(
    ['UI-041', 'UI-025'],
    'keyboard reorders a real repository tab without changing its active repository; saved order and active ID survive a fresh route',
  );
  async function drag(from, to, drop) {
    await wait(
      wc,
      `(()=>{const src=(${wrap(from)}),dst=(${wrap(to)}),list=(${tabList});if(!src||!dst||!list)return false;
    const dt=new DataTransfer(),r=dst.getBoundingClientRect(),pt={clientX:r.right-2,clientY:r.top+r.height/2,dataTransfer:dt,bubbles:true,cancelable:true};
    src.dispatchEvent(new DragEvent('dragstart',pt));list.dispatchEvent(new DragEvent('dragenter',pt));list.dispatchEvent(new DragEvent('dragover',pt));
    if(${drop})list.dispatchEvent(new DragEvent('drop',pt));else{list.dispatchEvent(new DragEvent('dragleave',{...pt,clientX:-1,clientY:-1}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))}
    src.dispatchEvent(new DragEvent('dragend',pt));src.querySelector('.repository-tab__select').click();return true})()`,
    );
  }
  await drag(scratch, linked, false);
  await check([scratch, original, linked], original);
  await drag(scratch, linked, true);
  await check([original, linked, scratch], original);
  await menu(linked, true);
  const right = closeCommand('关闭右侧所有标签页', 1);
  await wait(wc, right);
  await keys(right, 'Escape');
  await wait(wc, '!(' + right + ')');
  await check([original, linked, scratch], original);
  await menu(linked);
  await click(right);
  await check([original, linked], original);
  await pass(
    ['UI-041', 'UI-025'],
    'cancel and complete tab dragging; dismiss the keyboard menu without side effects, then close just the right-hand tab using the displayed count',
  );
  await window.loadURL(origin + '/repositories/' + scratch);
  await check([original, linked, scratch], scratch);
  await menu(linked);
  await click(closeCommand('关闭左侧所有标签页', 1));
  await check([linked, scratch], scratch);
  await menu(linked, true);
  await click(closeCommand('关闭其他标签页', 1));
  await check([linked], linked);
  await click(element(selector(linked) + ' .repository-tab__close'));
  await check([], null);
  assert.ok(fs.existsSync(path.join(linkedPath, '.git')));
  await window.loadURL(origin + '/repositories/' + original);
  await check([original], original);
  await window.loadURL(origin + '/repositories/' + scratch);
  await check([original, scratch], scratch);
  await window.loadURL(origin + '/repositories/' + linked);
  await check([original, scratch, linked], linked);
  await pass(
    ['UI-041', 'UI-025'],
    'close left, other and last tabs, reopen all three registrations and verify the persisted active tab, order and physical worktree',
  );
  // Leave an intentional, non-creation order. The Git-actions test then
  // unregisters scratch, leaving [linked, original] for the next process.
  await keys(handle(linked), 'ArrowLeft', { altKey: true });
  await check([original, linked, scratch], linked);
  await keys(handle(linked), 'ArrowLeft', { altKey: true });
  await check([linked, original, scratch], linked);
  fs.writeFileSync(
    path.join(process.env.ALUNE_SMOKE_DIR, 'tab-restore-proof.json'),
    JSON.stringify({ ids: [linked, original], activeId: original, linkedPath }),
  );
};
