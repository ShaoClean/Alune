const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process'),
  { pathToFileURL } = require('node:url');
module.exports = async ({ window, wc, work, wait, fact, pass }) => {
  const { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const ev = (s) => wc.executeJavaScript(s),
    primary = (t) => textButton(t, '.a-dlg-actions button'),
    start = wc.getURL(),
    origin = new URL(start).origin;
  const base = fs.mkdtempSync(path.join(path.dirname(work), 'author-context-')),
    upstream = path.join(base, 'upstream.git'),
    clone = path.join(base, 'author-workspace');
  execFileSync('git', ['clone', '--bare', '-q', work, upstream]);
  execFileSync('git', [
    'clone',
    '-q',
    '--depth',
    '1',
    '--branch',
    'main',
    pathToFileURL(upstream).href,
    clone,
  ]);
  const git = (...args) =>
    execFileSync('git', ['-C', clone, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('config', 'core.autocrlf', 'false');
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(git('rev-list', '--count', 'HEAD'), '1');
  const globalFile = process.env.GIT_CONFIG_GLOBAL;
  assert.equal(
    fs.realpathSync.native(path.dirname(globalFile)),
    fs.realpathSync.native(process.env.ALUNE_SMOKE_DIR),
  );
  const globalBefore = fs.readFileSync(globalFile);
  fs.writeFileSync(path.join(clone, 'scratch.txt'), 'staged author proof\n');
  git('add', 'scratch.txt');
  fs.writeFileSync(path.join(clone, 'scratch.txt'), 'working author proof\n');
  const fingerprint = () => [
    git('rev-parse', 'HEAD'),
    git('status', '--porcelain'),
    git('diff', '--cached', '--binary'),
    git('diff', '--binary'),
  ];
  const unchanged = fingerprint();
  await window.loadURL(origin + '/repositories');
  await click(button('打开本地仓库'));
  await input(element('#local-repo-path'), clone);
  await click(textButton('检查仓库'));
  await click(primary('打开工作区'));
  await wait(wc, "document.querySelector('.branch-pill__name')?.textContent.trim()==='main'");
  const repoURL = wc.getURL();
  async function notice(title, dismissErrors = []) {
    await wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');
      if(n){const heading=n.querySelector('#feedback-title')?.textContent;
        if(heading===${JSON.stringify(title)})return true;
        const manual=['提交前需要设置作者','浅克隆仅显示已获取的历史','未配置远程'].includes(heading);
        if(manual||${JSON.stringify(dismissErrors)}.includes(heading)||(n.dataset.tone==='info'&&/进行中$/.test(heading??''))){n.querySelector('[aria-label="关闭提示"]').click();return false;}
        throw Error(n.innerText);
      }
      const inbox=document.querySelector('#feedback-inbox:popover-open');
      if(inbox){const item=[...inbox.querySelectorAll('.fb-item-open')].find(e=>e.getClientRects().length&&e.querySelector('strong')?.textContent===${JSON.stringify(title)});if(item)item.click();return false;}
      const trigger=[...document.querySelectorAll('.status-button--feedback')].find(e=>e.getClientRects().length&&!e.closest('[inert]'));if(trigger)trigger.click();return false;
    })()`,
    );
  }
  await notice('提交前需要设置作者');
  await click(textButton('设置作者', '.feedback-dialog button'));
  await wait(wc, '(' + primary('保存到此仓库') + ')?.disabled===true');
  await input(element('#git-author-name'), '  Saved author  ');
  await input(element('#git-author-email'), 'saved-author@example.invalid');
  await click(primary('取消'));
  assert.throws(() => git('config', '--local', '--get', 'user.name'));
  assert.throws(() => git('config', '--local', '--get', 'user.email'));
  await notice('提交前需要设置作者');
  await click(textButton('设置作者', '.feedback-dialog button'));
  await input(element('#git-author-name'), '  Saved author  ');
  await input(element('#git-author-email'), 'saved-author@example.invalid');
  await click(primary('保存到此仓库'));
  await fact(
    () =>
      git('config', '--local', '--get', 'user.name') === 'Saved author' &&
      git('config', '--local', '--get', 'user.email') === 'saved-author@example.invalid',
    'author not saved locally',
  );
  await window.loadURL(repoURL);
  await wait(wc, "document.querySelector('.branch-pill__name')?.textContent.trim()==='main'");
  await wait(
    wc,
    "!document.querySelector('.feedback-list')?.textContent.includes('提交前需要设置作者')",
  );
  assert.deepEqual(fs.readFileSync(globalFile), globalBefore);
  assert.deepEqual(fingerprint(), unchanged);
  await pass(
    ['UI-035'],
    'cancel author settings without writing either key, then save both local keys and reopen; global Git configuration, HEAD, index and working bytes remain unchanged',
  );
  await notice('浅克隆仅显示已获取的历史');
  await click(element('.feedback-dialog[open] [aria-label="关闭提示"]'));
  const configPath = path.resolve(clone, git('rev-parse', '--git-path', 'config'));
  const configBefore = fs.readFileSync(configPath);
  fs.appendFileSync(configPath, '\n[malformed-test-section\n');
  try {
    await click(button('刷新仓库'));
    await notice('无法读取仓库配置', ['无法读取仓库状态']);
  } finally {
    fs.writeFileSync(configPath, configBefore);
  }
  assert.deepEqual(fingerprint(), unchanged);
  await click(textButton('重试', '.feedback-dialog button'));
  await wait(
    wc,
    "!document.querySelector('.feedback-list')?.textContent.includes('无法读取仓库配置')",
  );
  if (
    await ev("document.querySelector('.feedback-list')?.textContent.includes('无法读取仓库状态')")
  ) {
    await notice('无法读取仓库状态');
    await click(textButton('重试状态', '.feedback-dialog button'));
  }
  await wait(
    wc,
    "!document.querySelector('.feedback-list')?.textContent.includes('无法读取仓库状态')",
  );
  assert.equal(git('config', '--local', 'user.name'), 'Saved author');
  assert.deepEqual(fingerprint(), unchanged);
  await pass(
    ['UI-035', 'UI-072'],
    'a malformed local Git config reports an actual context read error; restore its exact bytes and explicitly retry to recover the saved author without touching HEAD, index or working files',
  );
  const offline = upstream + '.offline';
  fs.renameSync(upstream, offline);
  try {
    await notice('浅克隆仅显示已获取的历史');
    await click(textButton('获取完整历史', '.feedback-dialog button'));
    await notice('获取完整历史未完成');
    assert.equal(git('rev-parse', '--is-shallow-repository'), 'true');
    assert.deepEqual(fingerprint(), unchanged);
  } finally {
    fs.renameSync(offline, upstream);
  }
  await click(textButton('重试', '.feedback-dialog button'));
  await fact(
    () => git('rev-parse', '--is-shallow-repository') === 'false',
    'explicit unshallow retry did not finish',
  );
  assert.ok(Number(git('rev-list', '--count', 'HEAD')) > 1);
  assert.deepEqual(fingerprint(), unchanged);
  assert.deepEqual(fs.readFileSync(globalFile), globalBefore);
  await window.loadURL(repoURL);
  await wait(wc, "document.querySelector('.branch-pill__name')?.textContent.trim()==='main'");
  await pass(
    ['UI-035'],
    'a real shallow fetch fails while its isolated upstream is unavailable; inspect unchanged Git state, restore the upstream and explicitly retry to acquire full history without altering HEAD or user edits',
  );
  git('remote', 'remove', 'origin');
  await click(button('刷新仓库'));
  await notice('未配置远程');
  await click(textButton('添加远程', '.feedback-dialog button'));
  await wait(wc, textButton('添加远程'));
  assert.equal(git('remote'), '');
  await click(textButton('添加远程'));
  await input(element('#remote-name'), 'origin');
  await input(element('#remote-url'), pathToFileURL(upstream).href);
  await click(primary('添加远程'));
  await fact(
    () => git('remote', 'get-url', 'origin') === pathToFileURL(upstream).href,
    'remote not restored',
  );
  assert.deepEqual(fingerprint(), unchanged);
  await pass(
    ['UI-035', 'UI-034'],
    'the missing-remote notice opens remote management; add the isolated upstream through its form and preserve the original Git content',
  );
  await window.loadURL(origin + '/repositories');
  await click(button('删除 author-workspace'));
  await click(textButton('移除登记'));
  await wait(wc, '!(' + button('删除 author-workspace') + ')');
  assert.deepEqual(fingerprint(), unchanged);
  await window.loadURL(start);
  await click(button('分支'));
};
