const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, wc, work, wait, fact, pass }) => {
  const { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const ev = (s) => wc.executeJavaScript(s),
    original = wc.getURL(),
    origin = new URL(original).origin;
  const base = fs.mkdtempSync(path.join(path.dirname(work), 'history-recovery-')),
    repo = path.join(base, 'history-recovery');
  fs.mkdirSync(repo);
  const run = (args, stdin) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      input: stdin,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const git = (...args) => run(args);
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Read recovery');
  git('config', 'user.email', 'recovery@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  fs.writeFileSync(path.join(repo, 'main.txt'), 'keep working content\n');
  git('add', 'main.txt');
  git('commit', '-qm', 'stable main');
  const blameOwner = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'later.txt'), 'independent later change\n');
  git('add', 'later.txt');
  git('commit', '-qm', 'later main');
  for (let i = 0; i < 8; i++) git('commit', '--allow-empty', '-qm', 'cached history ' + i);

  const head = git('rev-parse', 'HEAD'),
    index = git('rev-parse', ':main.txt');
  const blob = run(['hash-object', '-w', '--stdin'], 'restored historical content\n');
  const tree = run(
    ['mktree'],
    git('ls-tree', 'HEAD') + '\n100644 blob ' + blob + '\trecovery.txt\n',
  );
  const recovery = run(['commit-tree', tree, '-p', head, '-m', 'recover tree fixture']);
  git('update-ref', 'refs/heads/recover-tree', recovery);
  const body =
    'tree ' +
    git('rev-parse', 'HEAD^{tree}') +
    '\nparent ' +
    head +
    '\nauthor Read recovery <recovery@example.invalid> 1700000000 +0000\ncommitter Read recovery <recovery@example.invalid> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n ZmFrZQ==\n -----END PGP SIGNATURE-----\n\nverification fixture\n';
  const signed = run(['hash-object', '-w', '-t', 'commit', '--stdin'], body);
  git('update-ref', 'refs/heads/verification-fixture', signed);
  git('config', 'gpg.format', 'openpgp');
  git('config', 'gpg.program', path.join(base, 'intentionally-missing-verifier'));
  const bare = path.join(base, 'origin.git');
  execFileSync('git', ['clone', '--bare', '-q', repo, bare]);
  git('remote', 'add', 'origin', bare);
  await window.loadURL(origin + '/repositories');
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), repo);
  await click(textButton('检查仓库'));
  await click(textButton('打开工作区', '.a-dlg-actions button'));
  await click(button('分支'));
  await click(textButton('创建标签'));
  await input(button('标签名称'), 'warm-history-snapshot');
  await click(textButton('创建标签', '.a-dlg-actions button'));
  await wait(
    wc,
    `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(!n)return false;const t=n.querySelector('#feedback-title')?.textContent;if(t==='已创建标签 warm-history-snapshot')return true;if(n.dataset.tone==='info'&&/进行中$/.test(t??'')){n.querySelector('[aria-label="关闭提示"]').click();return false;}throw Error(n.innerText)})()`,
  );
  await click(element('.feedback-dialog[open] [aria-label="关闭提示"]'));
  assert.equal(git('rev-parse', 'warm-history-snapshot'), head);
  await click(button('提交历史'));
  const row = (h) => element('.history-row[data-hash="' + h + '"]'),
    title = "document.querySelector('.feedback-dialog[open] #feedback-title')?.textContent";
  await wait(wc, row(recovery));
  await click(row(head));
  await wait(
    wc,
    'document.querySelector(".history-detail code[title]")?.title===' + JSON.stringify(head),
  );
  const separator = button('调整提交图与详情高度');
  await ev(
    '(' +
      separator +
      ').dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true,cancelable:true}))',
  );
  await wait(
    wc,
    '(' +
      separator +
      ').getAttribute("aria-valuenow")===(' +
      separator +
      ').getAttribute("aria-valuemin")',
  );
  await ev(
    "(()=>{const v=document.querySelector('.history-viewport');v.scrollTop=80;v.dispatchEvent(new Event('scroll',{bubbles:true}))})()",
  );
  await wait(wc, "document.querySelector('.history-viewport').scrollTop>=79");
  const scrollBefore = await ev("document.querySelector('.history-viewport').scrollTop");
  await click(button('文件'));
  await click(button('提交历史'));
  await wait(
    wc,
    'Math.abs(document.querySelector(".history-viewport").scrollTop-' + scrollBefore + ')<2',
  );
  assert.equal(await ev('document.querySelector(".history-detail code[title]")?.title'), head);
  await pass(
    ['UI-013', 'UI-021', 'UI-022'],
    'prime history through a real tag creation, scroll its cached graph and switch panels; returning preserves both scroll position and the selected commit',
  );
  await click(button('关闭提交详情'));
  const treeObject = path.join(repo, '.git', 'objects', tree.slice(0, 2), tree.slice(2)),
    held = path.join(base, 'held-tree');
  const dismiss = async (allowed) =>
    wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(!n)return true;const t=n.querySelector('#feedback-title')?.textContent;const treeSignature=t==='签名验证未完成'&&n.innerText.includes(${JSON.stringify(tree)});if(!${JSON.stringify(allowed)}.includes(t)&&!treeSignature)throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false})()`,
    );
  // Git for Windows also consults the tree during signature-header reads.
  // Select the file-read notice explicitly when that same injected missing
  // tree produces several concurrent notices; reject unrelated failures.
  const fileNotice = (action = false) =>
    wait(
      wc,
      `(()=>{
    const n=document.querySelector('.feedback-dialog[open]');
    if(n){const t=n.querySelector('#feedback-title')?.textContent;
      if(t==='提交文件读取失败'){if(${action}){const b=[...n.querySelectorAll('button')].find(e=>e.textContent.trim()==='重试');if(!b||b.disabled)return false;b.click();}return true;}
      if(t==='无法加载差异'||(t==='签名验证未完成'&&n.innerText.includes(${JSON.stringify(tree)}))){n.querySelector('[aria-label="关闭提示"]').click();return false;}
      throw Error(n.innerText);
    }
    const inbox=document.querySelector('#feedback-inbox:popover-open');
    if(inbox){const item=[...inbox.querySelectorAll('.fb-item-open')].find(e=>e.querySelector('strong')?.textContent==='提交文件读取失败');if(item)item.click();return false;}
    const trigger=[...document.querySelectorAll('.status-button--feedback')].find(e=>e.getClientRects().length&&!e.closest('[inert]'));if(trigger)trigger.click();return false;
  })()`,
    );
  for (const mode of ['notice', 'inline']) {
    fs.renameSync(treeObject, held);
    try {
      await click(row(recovery));
      await wait(
        wc,
        "document.querySelector('.history-detail')?.innerText.includes('无法读取提交文件')",
      );
      if (mode === 'notice') await fileNotice();
      assert.equal(git('rev-parse', 'HEAD'), head);
    } finally {
      fs.renameSync(held, treeObject);
    }
    if (mode === 'notice') await fileNotice(true);
    else {
      await dismiss(['提交文件读取失败', '无法加载差异']);
      await click(textButton('重试', '.history-detail .text-button'));
    }
    await wait(wc, button('查看提交文件 recovery.txt'));
    await dismiss(['提交文件读取失败', '无法加载差异']);
    await click(button('查看提交文件 recovery.txt'));
    await wait(
      wc,
      "document.querySelector('.history-detail')?.innerText.includes('restored historical content')",
    );
    await dismiss(['提交文件读取失败', '无法加载差异']);
    assert.equal(
      await ev('document.querySelector(".history-detail code[title]")?.title'),
      recovery,
    );
    assert.equal(git('rev-parse', ':main.txt'), index);
    await pass(
      ['UI-022', 'UI-015'],
      'a missing historical tree fails commit-file and Diff reads; restoring the exact object and using the ' +
        mode +
        ' retry recovers the same commit and file bytes',
    );
    await click(button('关闭提交详情'));
  }
  const config = path.join(repo, '.git', 'config'),
    savedConfig = fs.readFileSync(config);
  const apply = async (value) => {
    await input(button('搜索提交信息或哈希'), value);
    await ev(
      '(' +
        button('搜索提交信息或哈希') +
        ').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))',
    );
  };
  git('config', 'gpg.format', 'invalid-history-test-format');
  try {
    await apply('verification fixture');
    await wait(wc, row(signed));
    await wait(wc, title + "==='签名验证未完成'");
    await wait(
      wc,
      "document.querySelector('.feedback-dialog[open]')?.innerText.includes('invalid-history-test-format')",
    );
  } finally {
    fs.writeFileSync(config, savedConfig);
  }
  await click(textButton('重试验证', '.feedback-dialog[open] button'));
  await wait(
    wc,
    '(' + row(signed) + ')?.querySelector(".commit-signature")?.textContent==="未知密钥／信任"',
  );
  await dismiss(['签名验证未完成']);
  await pass(
    ['UI-021'],
    'a real verifier configuration error is shown by the graph; after restoring configuration, explicit retry reports unknown verification for the intentionally unavailable verifier, never unsigned or valid',
  );
  git('config', 'gpg.format', 'invalid-history-test-format');
  try {
    await click(row(signed));
    await wait(wc, textButton('重试验证', '.history-detail button'));
  } finally {
    fs.writeFileSync(config, savedConfig);
  }
  await dismiss(['签名验证未完成', '提交文件读取失败', '无法加载差异']);
  await click(textButton('重试验证', '.history-detail button'));
  await wait(
    wc,
    "document.querySelector('.history-detail .commit-signature--detail')?.textContent.startsWith('未知密钥／信任')",
  );
  assert.equal(await ev('document.querySelector(".history-detail code[title]")?.title'), signed);
  await pass(
    ['UI-022'],
    'detail-level signature verification fails and explicitly retries against the same historical commit; the controlled unavailable verifier remains unknown rather than falsely verified',
  );
  await click(button('文件'));
  const mainFile =
    '[...document.querySelectorAll(".files-tree__item")].find(e=>e.getClientRects().length&&e.textContent.trim()==="main.txt")';
  await click(mainFile);
  await wait(
    wc,
    "document.querySelector('.files-code')?.textContent.includes('keep working content')",
  );
  await click(textButton('逐行追溯'));
  const owner = element('[data-blame-line="1"] .blame-row__commit');
  await wait(wc, '(' + owner + ')?.getAttribute("aria-label").includes("stable main")');
  const commitObject = path.join(
      repo,
      '.git',
      'objects',
      blameOwner.slice(0, 2),
      blameOwner.slice(2),
    ),
    heldCommit = path.join(base, 'held-commit');
  fs.renameSync(commitObject, heldCommit);
  try {
    await click(owner);
    await wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(!n)return false;const t=n.querySelector('#feedback-title')?.textContent??'';if(t.startsWith('无法读取追溯信息'))return true;if(['提交历史读取失败','提交历史已变化','提交文件读取失败','无法加载差异'].some(v=>t.startsWith(v))){n.querySelector('[aria-label="关闭提示"]').click();return false;}throw Error(n.innerText)})()`,
    );
  } finally {
    fs.renameSync(heldCommit, commitObject);
  }
  await click(textButton('重试', '.feedback-dialog[open] button'));
  await wait(
    wc,
    'document.querySelector(".history-detail code[title]")?.title===' + JSON.stringify(blameOwner),
  );
  await wait(wc, button('查看提交文件 main.txt'));
  await dismiss(['提交历史读取失败', '提交文件读取失败', '无法加载差异']);
  await click(button('查看提交文件 main.txt'));
  await wait(
    wc,
    "document.querySelector('.history-detail')?.innerText.includes('keep working content')",
  );
  await pass(
    ['UI-004', 'UI-022'],
    'a cached Blame link encounters a missing old commit; restoring that exact object and explicitly retrying opens the requested ancestor, not the newer HEAD',
  );
  const brokenRef = path.join(repo, '.git', 'refs', 'heads', 'missing-history-object');
  fs.writeFileSync(brokenRef, '4'.repeat(40) + '\n');
  try {
    await window.loadURL(wc.getURL());
    await click(button('提交历史'));
    await wait(
      wc,
      "document.querySelector('.history-workspace__graph')?.textContent.includes('无法读取提交历史')",
    );
  } finally {
    fs.unlinkSync(brokenRef);
  }
  await wait(
    wc,
    `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(n){if(n.querySelector('#feedback-title')?.textContent!=='提交历史读取失败')throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false;}const b=(${textButton('重试', '.history-workspace__graph .text-button')});if(!b)return false;b.click();return true})()`,
  );
  await wait(wc, row(head));
  const all = git('log', '--topo-order', '--all', 'HEAD', '--format=%H').split(/\r?\n/);
  const visible = await ev(
    "[...document.querySelectorAll('.history-row')].filter(e=>e.getClientRects().length).map(e=>e.dataset.hash)",
  );
  assert.deepEqual(visible, all);
  await pass(
    ['UI-021'],
    'a missing referenced commit fails the initial history list; repair only the test ref and explicitly retry to recover the exact ordered Git commits',
  );
  await apply('no matching history fixture string');
  await wait(
    wc,
    "document.querySelector('.history-workspace__graph .empty-state')?.textContent.includes('没有符合筛选条件')",
  );
  await click(textButton('清除筛选', '.history-workspace__graph .empty-state button'));
  await wait(wc, row(head));
  assert.deepEqual(
    await ev(
      "[...document.querySelectorAll('.history-row')].filter(e=>e.getClientRects().length).map(e=>e.dataset.hash)",
    ),
    all,
  );
  const refsBeforePlans = git('show-ref');
  const expectedPlan = git('log', '--reverse', '--format=%s', blameOwner + '..HEAD').split(/\r?\n/);
  const verifyPlan = async () => {
    await wait(
      wc,
      "[...document.querySelectorAll('.rebase-entry__subject')].filter(e=>e.getClientRects().length).some(e=>e.title.trim()==='later main')",
    );
    assert.deepEqual(
      await ev(
        "[...document.querySelectorAll('.rebase-entry__subject')].filter(e=>e.getClientRects().length).map(e=>e.title.trim())",
      ),
      expectedPlan,
    );
  };

  await click(row(blameOwner));
  await wait(
    wc,
    'document.querySelector(".history-detail code[title]")?.title===' + JSON.stringify(blameOwner),
  );
  await click(button('关闭提交详情'));
  await click(textButton('从所选提交交互式变基'));
  await verifyPlan();
  await click(textButton('取消', '.a-dlg-actions button'));
  await wait(wc, "!document.querySelector('.a-dlg-shell')");
  const target = row(blameOwner);
  await ev(
    '(()=>{const e=(' +
      target +
      '),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,button:2,clientX:r.left+20,clientY:r.top+5}))})()',
  );
  await click(textButton('从此处交互式变基', '.ant-dropdown-menu-item'));
  await verifyPlan();
  await click(textButton('取消', '.a-dlg-actions button'));
  await wait(wc, "!document.querySelector('.a-dlg-shell')");
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('show-ref'), refsBeforePlans);
  assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), false);
  await pass(
    ['UI-021', 'UI-024'],
    'clear an empty filter using its own action, open rebase from the selected ancestor through both toolbar and row menu, cancel both plans and preserve every Git ref',
  );
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('rev-parse', ':main.txt'), index);
  assert.equal(fs.readFileSync(path.join(repo, 'main.txt'), 'utf8'), 'keep working content\n');
  await window.loadURL(origin + '/repositories');
  await click(button('删除 history-recovery'));
  await click(textButton('移除登记'));
  await wait(wc, '!(' + button('删除 history-recovery') + ')');
  assert.equal(git('rev-parse', 'HEAD'), head);
  await window.loadURL(original);
};
