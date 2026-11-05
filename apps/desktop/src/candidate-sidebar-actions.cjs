// The tree and tab strip have independent order. Compare the actual sidebar,
// native workspace preferences, active route and the linked worktree.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, wc, origin, original, linked, linkedPath, wait, pass }) => {
  const { element, button, click, input, textButton } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const ev = (code) => wc.executeJavaScript(code);
  const group = '#remote-workspace-tree [data-connection-id="@local"]';
  const row = (id) => group + ' [data-repository-id="' + id + '"]';
  const select = (id) => element(row(id) + ' .tree-node__action');
  const toggle = element(group + ' .tree-node--connection .tree-node__action');
  const list =
    '[...document.querySelectorAll(' +
    JSON.stringify(group + ' [data-repository-id]') +
    ')].filter(e=>e.getClientRects().length).map(e=>e.dataset.repositoryId)';
  const state = async () => JSON.parse(await ev('window.aluneWorkspace.load()')).state;
  const git = (...args) =>
    execFileSync('git', ['-C', linkedPath, ...args], { encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD'),
    status = git('status', '--porcelain');
  async function saved(test, message) {
    const end = Date.now() + 10000;
    do {
      if (test(await state())) return;
      await new Promise((r) => setTimeout(r, 35));
    } while (Date.now() < end);
    assert.fail(message);
  }
  const showOrder = (ids) =>
    wait(wc, 'JSON.stringify(' + list + ')===' + JSON.stringify(JSON.stringify(ids)));
  const pathFor = (id) => '/repositories/' + id;
  const active = async (id) => {
    await wait(
      wc,
      'location.pathname===' +
        JSON.stringify(pathFor(id)) +
        '&&(' +
        select(id) +
        ')?.getAttribute("aria-current")==="page"',
    );
    await saved((s) => s.repositorySession.activeId === id, 'wrong persisted active repository');
  };
  await wait(wc, select(linked));
  const tabs = (await state()).repositorySession.ids;
  const order = await ev(list);
  assert.ok(order.length >= 3 && order.includes(linked) && order.includes(original));
  await click(select(original));
  await active(original);
  await click(select(linked));
  await active(linked);
  assert.deepEqual((await state()).repositorySession.ids, tabs);
  await click(toggle);
  await showOrder([]);
  await saved((s) => s.collapsedConnectionIds.includes('@local'), 'fold not saved');
  await window.loadURL(origin + pathFor(linked));
  await wait(wc, '(' + toggle + ')?.getAttribute("aria-expanded")==="false"');
  await input(button('查找仓库'), 'ui-linked');
  await showOrder([linked]);
  assert.equal(await ev('(' + element(row(linked) + ' .tree-sort-handle') + ').disabled'), true);
  await input(button('查找仓库'), 'not-an-alune-fixture-1971');
  await wait(
    wc,
    'document.querySelector("#remote-workspace-tree .tree-empty")?.textContent.includes("没有匹配")',
  );
  await input(button('查找仓库'), '');
  await wait(wc, '(' + toggle + ')?.getAttribute("aria-expanded")==="false"');
  await click(toggle);
  await showOrder(order);
  await pass(
    ['UI-051', 'UI-025'],
    'switch repositories from the tree; a folded local group survives reload, temporarily expands for a worktree search and returns to its saved fold after clearing',
  );
  const [a, b] = order;
  const sort = (id) => element(row(id) + ' .tree-sort-handle');
  await click(sort(b));
  await wait(
    wc,
    '(()=>{const e=(' +
      sort(b) +
      ');if(!e||e.disabled)return false;e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",altKey:true,bubbles:true,cancelable:true}));return true})()',
  );
  const moved = [b, a, ...order.slice(2)];
  await showOrder(moved);
  await saved(
    (s) => JSON.stringify(s.repositoryOrderByConnection['@local']) === JSON.stringify(moved),
    'tree keyboard order not saved',
  );
  await window.loadURL(origin + pathFor(linked));
  await showOrder(moved);
  await active(linked);
  assert.deepEqual((await state()).repositorySession.ids, tabs);
  await pass(
    ['UI-051'],
    'Alt+Up reorders actual repository rows and persists through reload without altering the tab strip or the selected worktree',
  );
  const drag = async (finish) =>
    wait(
      wc,
      `(()=>{const src=(${sort(b)}), dst=(${element(row(a))}), container=(${element('#remote-workspace-tree')});if(!src||!dst||!container)return false;const dt=new DataTransfer(),r=dst.getBoundingClientRect(),args={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+12,clientY:r.bottom-1};src.dispatchEvent(new DragEvent('dragstart',args));dst.dispatchEvent(new DragEvent('dragover',args));if(${finish})dst.dispatchEvent(new DragEvent('drop',args));else{container.dispatchEvent(new DragEvent('dragleave',{...args,relatedTarget:document.body}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));}src.dispatchEvent(new DragEvent('dragend',args));dst.querySelector('.tree-node__action').click();return true})()`,
    );
  await drag(false);
  await showOrder(moved);
  await active(linked);
  await drag(true);
  await showOrder(order);
  await saved(
    (s) => JSON.stringify(s.repositoryOrderByConnection['@local']) === JSON.stringify(order),
    'dropped order not saved',
  );
  await active(linked);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), status);
  await pass(
    ['UI-051'],
    'cancel a tree drag, then drop below a sibling; suppress the trailing click, verify the persisted order, active repository and unchanged Git worktree',
  );

  const extra = fs.mkdtempSync(path.join(process.env.ALUNE_SMOKE_DIR, 'sidebar-remove-'));
  const extraGit = (...args) =>
    execFileSync('git', ['-C', extra, ...args], { encoding: 'utf8' }).trim();
  const file = path.join(extra, 'proof.txt');
  extraGit('init', '-qb', 'main');
  extraGit('config', 'user.name', 'Fixture');
  extraGit('config', 'user.email', 'fixture@example.invalid');
  extraGit('remote', 'add', 'origin', path.join(process.env.ALUNE_SMOKE_DIR, 'fixture-remote.git'));
  fs.writeFileSync(file, 'committed\n');
  extraGit('add', 'proof.txt');
  extraGit(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '-qm',
    'sidebar',
  );
  fs.writeFileSync(file, 'staged\n');
  extraGit('add', 'proof.txt');
  fs.writeFileSync(file, 'working\n');
  const actual = () => [
    extraGit('rev-parse', 'HEAD'),
    extraGit('show', ':proof.txt'),
    fs.readFileSync(file, 'utf8'),
    extraGit('status', '--porcelain'),
  ];
  const before = actual();
  assert.deepEqual(before.slice(1), ['staged', 'working\n', 'MM proof.txt']);
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), extra);
  await click(textButton('检查仓库'));
  await click(textButton('打开工作区', '.a-dlg-actions button'));
  await wait(
    wc,
    "document.querySelector('.tree-node--selected .tree-node__action')?.getAttribute('aria-label')?.includes(" +
      JSON.stringify(path.basename(extra)) +
      ')',
  );
  const extraId = new URL(wc.getURL()).pathname.split('/').at(-1);
  assert.ok(!tabs.includes(extraId));
  await active(extraId);
  const more = element(row(extraId) + ' .tree-node__more');
  await click(more);
  const menu = element('.workspace-actions');
  await wait(wc, '(' + menu + ')?.contains(document.activeElement)');
  await ev(
    "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
  );
  await wait(
    wc,
    '(' +
      more +
      ')?.getAttribute("aria-expanded")==="false"&&document.activeElement===(' +
      more +
      ')',
  );
  await click(more);
  await click(textButton('移除仓库登记', '.workspace-actions button'));
  await wait(wc, 'document.body.innerText.includes(' + JSON.stringify(extra) + ')');
  await click(textButton('取消', '.ant-popconfirm button'));
  await active(extraId);
  assert.deepEqual(actual(), before);
  await pass(
    ['UI-049', 'UI-051', 'UI-002'],
    'Escape dismisses the actions menu and returns focus; cancelling sidebar removal preserves the active registration, staged blob and working file',
  );
  if (await ev('(' + more + ').getAttribute("aria-expanded")==="false"')) await click(more);
  await click(textButton('移除仓库登记', '.workspace-actions button'));
  // Start an actual removal, then choose a different existing repository
  // before the Agent replies. Completing the older operation must not steal focus.
  const acceptRemove = textButton('移除登记', '.ant-popconfirm button');
  await wait(
    wc,
    `(()=>{const ok=(${acceptRemove}),pick=(${select(original)});if(!ok||ok.disabled||!pick)return false;ok.click();pick.click();return true})()`,
  );
  await wait(wc, '!document.querySelector(' + JSON.stringify(row(extraId)) + ')');
  await saved(
    (s) =>
      !s.repositorySession.ids.includes(extraId) &&
      !s.repositoryOrderByConnection['@local'].includes(extraId),
    'removed registration stayed in the saved session or sidebar order',
  );
  await active(original);
  await window.loadURL(origin + pathFor(linked));
  await active(linked);
  await showOrder(order);
  assert.deepEqual((await state()).repositorySession.ids, tabs);
  assert.deepEqual(actual(), before);
  await pass(
    ['UI-049', 'UI-051', 'UI-002', 'UI-025'],
    'confirm sidebar removal and reload: the registration and tab are gone, other registrations retain their order, HEAD, staged blob and working bytes are unchanged',
  );
};
