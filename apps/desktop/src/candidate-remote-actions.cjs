const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, wc, work, git, wait, fact, pass }) => {
  const { element, button, textButton, input } = require('./candidate-ui-driver.cjs')(wc, wait);
  const ev = (s) => wc.executeJavaScript(s),
    primary = (t) => textButton(t, '.a-dlg-actions button');
  const click = (expr) =>
    wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(n){const progress=n.dataset.tone==='info'&&/进行中$/.test(n.querySelector('#feedback-title')?.textContent??'')&&[...n.querySelectorAll('button')].some(b=>b.textContent.replace(/\\s/g,'')==='取消操作');if(n.dataset.tone!=='success'&&!progress)throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false;}const e=(${expr});if(!e||e.disabled||e.getAttribute('aria-busy')==='true'||e.classList.contains('ant-btn-loading'))return false;e.click();return true})()`,
    );
  const before = git('remote', '-v'),
    head = git('rev-parse', 'HEAD'),
    status = git('status', '--porcelain');
  await click(textButton('添加远程'));
  await input(element('#remote-name'), 'ui-address-preview');
  await input(element('#remote-url'), 'https://example.invalid/team/repository.git');
  for (const [label, prefix] of [
    ['GitHub SSH', 'git@github.com:'],
    ['GitLab SSH', 'git@gitlab.com:'],
    ['GitHub HTTPS', 'https://github.com/'],
  ]) {
    await click(textButton(label, '.dlg-chip-btn'));
    await wait(
      wc,
      'document.querySelector("#remote-url")?.value===' +
        JSON.stringify(prefix + 'team/repository.git') +
        '&&document.activeElement===document.querySelector("#remote-url")',
    );
  }
  await click(primary('取消'));
  assert.equal(git('remote', '-v'), before);
  assert.equal(git('rev-parse', 'HEAD'), head);
  await pass(
    ['UI-034'],
    'change remote URL prefixes while retaining its repository path and input focus; cancel the form and verify no remote configuration or Git ref changed',
  );
  const root = fs.mkdtempSync(path.join(path.dirname(work), 'remote-addresses-'));
  const fetchURL = path.join(root, 'fetch.git'),
    pushURL = path.join(root, 'push.git'),
    name = 'ui-copy-remote';
  execFileSync('git', ['init', '--bare', '-q', fetchURL]);
  execFileSync('git', ['init', '--bare', '-q', pushURL]);
  await click(textButton('添加远程'));
  await input(element('#remote-name'), 'origin');
  await input(element('#remote-url'), fetchURL);
  await click(primary('添加远程'));
  await wait(wc, primary('返回'));
  assert.match(
    await ev('(' + primary('返回') + ').closest(".a-dlg-shell").innerText'),
    /already exists|已存在/i,
  );
  assert.equal(git('remote', '-v'), before);
  await click(primary('返回'));
  await click(primary('取消'));
  await click(textButton('添加远程'));
  await input(element('#remote-name'), '  ' + name + '  ');
  await input(element('#remote-url'), '  ' + fetchURL + '  ');
  await click(primary('添加远程'));
  await fact(() => git('remote', 'get-url', name) === fetchURL, 'selected remote was not saved');
  const row =
    '[...document.querySelectorAll(".remote-card")].find(e=>e.getClientRects().length&&e.querySelector("strong")?.textContent===' +
    JSON.stringify(name) +
    ')';
  await wait(wc, row);
  git('remote', 'set-url', '--push', name, pushURL);
  await click(button('刷新远程'));
  await wait(wc, '(' + row + ')?.innerText.includes(' + JSON.stringify(pushURL) + ')');
  assert.equal(git('remote', 'get-url', '--push', name), pushURL);
  await pass(
    ['UI-034', 'UI-072'],
    'reject a duplicate remote without overwriting origin; save a trimmed name and local URL, then refresh an independently changed push URL',
  );
  const focusSmokeWindow = require('./smoke-window.cjs');
  const native = focusSmokeWindow.showNativeWindow && process.env.GITHUB_ACTIONS === 'true';
  if (native)
    assert.equal(
      process.env.RUNNER_ENVIRONMENT,
      'github-hosted',
      'native clipboard verification requires an isolated hosted runner',
    );
  if (native) {
    await focusSmokeWindow(window);
  } else {
    // The developer's clipboard is not part of this disposable test fixture.
    // Local replay checks the submitted value; hosted workers verify the real OS clipboard.
    await ev(
      '(()=>{window.__remoteOriginalCopy=navigator.clipboard.writeText;navigator.clipboard.writeText=async value=>{window.__remoteCopied=value};return true})()',
    );
  }
  try {
    for (const [kind, expected] of [
      ['获取', git('remote', 'get-url', name)],
      ['推送', git('remote', 'get-url', '--push', name)],
    ]) {
      const copyButton = button('复制 ' + name + ' 的' + kind + '地址');
      if (native) {
        await wait(wc, copyButton);
        await wc.executeJavaScript('(' + copyButton + ').click()', true);
        const { clipboard } = require('electron');
        const end = Date.now() + 4000;
        let actual = await clipboard.readText();
        while (actual !== expected && Date.now() < end) {
          await new Promise((r) => setTimeout(r, 40));
          actual = await clipboard.readText();
        }
        assert.equal(actual, expected, 'native clipboard did not receive the ' + kind + ' URL');
      } else {
        await click(copyButton);
        await wait(wc, 'window.__remoteCopied===' + JSON.stringify(expected));
      }
    }
  } finally {
    if (!native)
      await ev(
        'navigator.clipboard.writeText=window.__remoteOriginalCopy;delete window.__remoteOriginalCopy;delete window.__remoteCopied',
      );
  }
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), status);
  await pass(
    ['UI-034'],
    native
      ? 'copy fetch and push addresses to the real hosted OS clipboard; both round trips match their independent Git configuration'
      : 'copy fetch and push callbacks emit the independently configured values to a controlled renderer sink; the local OS clipboard is untouched',
    {
      clipboard: native
        ? 'hosted native OS clipboard'
        : 'controlled renderer sink; no local OS clipboard touched',
    },
  );
  git('remote', 'remove', name);
  await click(button('刷新远程'));
  await wait(wc, '!(' + row + ')');
  assert.equal(git('remote', '-v'), before);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), status);
  await pass(
    ['UI-034'],
    'refresh after externally removing only the test remote; its card disappears and all original remotes and Git content are preserved',
  );
  const config = path.resolve(work, git('rev-parse', '--git-path', 'config')),
    originalConfig = fs.readFileSync(config);
  fs.appendFileSync(config, '\n[malformed-remote-config\n');
  try {
    await window.loadURL(wc.getURL());
    await wc.executeJavaScript(`new Promise((resolve,reject)=>{let selected=false;const end=Date.now()+20000;const poll=()=>{try{
      const n=document.querySelector('.feedback-dialog[open]');if(n){const title=n.querySelector('#feedback-title')?.textContent;
        if(['远程读取失败','无法读取远程'].includes(title))return resolve(true);
        if(!['无法读取仓库状态','无法读取仓库配置'].includes(title))throw Error(n.innerText);
        n.querySelector('[aria-label="关闭提示"]').click();
      }else if(!selected){const b=(${button('远程')});if(b&&!b.disabled){b.click();selected=true;}}
      if(Date.now()>end)throw Error('Expected an actual remote-list failure');setTimeout(poll,40);
    }catch(e){reject(e)}};poll()})`);
  } finally {
    fs.writeFileSync(config, originalConfig);
  }
  const closeFaults = `const n=document.querySelector('.feedback-dialog[open]');if(n){if(!['远程读取失败','无法读取远程','无法读取仓库状态','无法读取仓库配置'].includes(n.querySelector('#feedback-title')?.textContent))throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false;}`;
  await wait(
    wc,
    `(()=>{${closeFaults}const retry=(${textButton('重试', '.workspace-panel .text-button')});if(!retry)return false;retry.click();return true})()`,
  );
  await wait(
    wc,
    "[...document.querySelectorAll('.remote-card')].some(e=>e.getClientRects().length&&e.querySelector('strong')?.textContent==='origin')",
  );
  assert.equal(git('remote', '-v'), before);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), status);
  await wait(wc, `(()=>{${closeFaults}return true})()`);
  await click(button('刷新仓库'));
  await wait(
    wc,
    "!document.querySelector('.feedback-list')?.textContent.includes('无法读取仓库配置')&&!document.querySelector('.feedback-list')?.textContent.includes('无法读取仓库状态')",
  );
  await pass(
    ['UI-034', 'UI-072'],
    'invalid local Git configuration fails the initial remote list; restore its exact bytes and explicitly retry to recover both original endpoints without altering Git content',
  );
};
