const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const http = require('node:http');
const { execFileSync, execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
module.exports = async ({ window, origin, repo, wait, pass }) => {
  const wc = window.webContents,
    ev = (s) => wc.executeJavaScript(s);
  const { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const base = fs.mkdtempSync(path.join(path.dirname(repo), 'submodule-ui-'));
  const source = path.join(base, 'source'),
    bare = path.join(base, 'child.git'),
    parent = path.join(base, 'submodule-parent'),
    child = path.join(parent, 'child');
  const original = wc.getURL();
  for (const dir of [source, parent]) fs.mkdirSync(dir);
  const git = (dir, ...args) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const init = (dir) => {
    git(dir, 'init', '-qb', 'main');
    git(dir, 'config', 'user.name', 'Submodule fixture');
    git(dir, 'config', 'user.email', 'module@example.invalid');
    git(dir, 'config', 'commit.gpgSign', 'false');
  };
  init(source);
  fs.writeFileSync(path.join(source, 'child.txt'), 'first child bytes\n');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'first child');
  const first = git(source, 'rev-parse', 'HEAD');
  execFileSync('git', ['clone', '--bare', '-q', source, bare]);
  execFileSync('git', ['--git-dir', bare, 'update-server-info']);
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['proxy-authorization'], undefined);
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(base, '.' + requested);
    if (!file.startsWith(bare + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': fs.statSync(file).size,
    });
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/child.git';
  try {
    init(parent);
    await run('git', ['-C', parent, 'submodule', 'add', url, 'child'], { windowsHide: true });
    git(child, 'config', 'user.name', 'Submodule fixture');
    git(child, 'config', 'user.email', 'module@example.invalid');
    git(parent, 'commit', '-qm', 'register child');
    fs.writeFileSync(path.join(source, 'child.txt'), 'second child bytes\n');
    git(source, 'add', '.');
    git(source, 'commit', '-qm', 'second child');
    const second = git(source, 'rev-parse', 'HEAD');
    git(source, 'push', bare, 'main');
    execFileSync('git', ['--git-dir', bare, 'update-server-info']);
    git(parent, 'update-index', '--cacheinfo', '160000,' + second + ',child');
    git(parent, 'commit', '-qm', 'advance recorded child');
    const parentRemote = path.join(base, 'parent.git');
    execFileSync('git', ['init', '--bare', '-q', parentRemote]);
    git(parent, 'remote', 'add', 'origin', parentRemote);
    const parentHead = git(parent, 'rev-parse', 'HEAD'),
      index = fs.readFileSync(path.join(parent, '.git', 'index'));
    assert.equal(git(child, 'rev-parse', 'HEAD'), first);
    await window.loadURL(origin + '/repositories');
    await click(button('打开本地仓库'));
    await input(element('#local-repo-path'), parent);
    await click(textButton('检查仓库'));
    await click(textButton('打开工作区', '.a-dlg-actions button'));
    await click(button('文件'));
    const panel = element('.repository-extensions'),
      item = element('.repository-extensions li');
    await wait(wc, '(' + item + ')?.innerText.includes("指针变化")');
    const parentUrl = wc.getURL();
    await click(textButton('初始化/更新', '.repository-extensions button'));
    await wait(wc, '(' + item + ')?.innerText.includes("提交一致")');
    assert.equal(git(child, 'rev-parse', 'HEAD'), second);
    assert.equal(fs.readFileSync(path.join(child, 'child.txt'), 'utf8'), 'second child bytes\n');
    assert.equal(git(parent, 'rev-parse', 'HEAD'), parentHead);
    assert.deepEqual(fs.readFileSync(path.join(parent, '.git', 'index')), index);
    await pass(
      ['UI-037', 'UI-072'],
      'initialize/update the actual HTTP-backed submodule to the exact recorded commit; verify child bytes, parent HEAD and unchanged gitlink index',
    );
    git(parent, 'config', 'submodule.child.url', url + '-wrong');
    await click(textButton('同步URL', '.repository-extensions button'));
    await wait(wc, '(' + panel + ')&&!(' + panel + ').querySelector("button:disabled")');
    assert.equal(git(parent, 'config', '--get', 'submodule.child.url'), url);
    assert.equal(git(child, 'rev-parse', 'HEAD'), second);
    assert.deepEqual(fs.readFileSync(path.join(parent, '.git', 'index')), index);
    await click(button('在新标签中打开子模块 child'));
    await wait(
      wc,
      'location.pathname!==' +
        JSON.stringify(new URL(parentUrl).pathname) +
        '&&["HEAD","游离 HEAD"].includes(document.querySelector(".branch-pill__name")?.textContent.trim())',
    );
    await click(button('文件'));
    const file =
      '[...document.querySelectorAll(".files-tree__item")].find(e=>e.getClientRects().length&&e.textContent.trim()==="child.txt")';
    await click(file);
    await wait(
      wc,
      'document.querySelector(".files-code")?.textContent.includes("second child bytes")',
    );
    await pass(
      ['UI-037', 'UI-025', 'UI-017'],
      'sync only the submodule URL from .gitmodules, then open its registered child in a new tab and read bytes from the expected child commit',
    );
    await window.loadURL(parentUrl);
    await click(button('文件'));
    await wait(wc, item);
    const config = path.resolve(child, git(child, 'rev-parse', '--git-path', 'config')),
      saved = fs.readFileSync(config);
    fs.appendFileSync(config, '\n[invalid-submodule-ui-fixture\n');
    try {
      await window.loadURL(parentUrl);
      await wait(
        wc,
        `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(n){if(!(n.innerText.replaceAll(String.fromCharCode(92),'/').includes('.git/modules/child/config')||n.innerText.includes('子模块')))throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false;}const e=(${button('文件')});if(!e||e.disabled||e.closest('[inert]'))return false;e.click();return true})()`,
      );
      await wait(
        wc,
        `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(n){if(!(n.innerText.replaceAll(String.fromCharCode(92),'/').includes('.git/modules/child/config')||n.innerText.includes('子模块')))throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false;}return !!(${panel})?.querySelector('[role=alert]')})()`,
      );
    } finally {
      fs.writeFileSync(config, saved);
    }
    await wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(!n)return true;if(!(n.innerText.replaceAll(String.fromCharCode(92),'/').includes('.git/modules/child/config')||n.innerText.includes('子模块')))throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false})()`,
    );
    await click(textButton('重试', '.repository-extensions button'));
    await wait(
      wc,
      '(' +
        item +
        ')?.innerText.includes("提交一致")&&!(' +
        panel +
        ').querySelector("[role=alert]")',
    );
    assert.equal(git(parent, 'rev-parse', 'HEAD'), parentHead);
    assert.deepEqual(fs.readFileSync(path.join(parent, '.git', 'index')), index);
    assert.equal(git(child, 'rev-parse', 'HEAD'), second);
    await pass(
      ['UI-037'],
      'a genuinely malformed child Git config causes a visible extension read failure; restoring its exact bytes and clicking retry restores the same module without changing Git refs or indexes',
    );
    await window.loadURL(origin + '/repositories');
    for (const name of ['child', 'submodule-parent']) {
      await click(button('删除 ' + name));
      await click(textButton('移除登记'));
      await wait(wc, '!(' + button('删除 ' + name) + ')');
    }
    await window.loadURL(original);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};
