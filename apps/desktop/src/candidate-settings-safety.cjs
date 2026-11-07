// Settings exercise a dedicated smoke profile. Choosers are controlled at the
// Electron boundary; application IPC, Agent queries and settings writes run.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const { dialog, BrowserWindow } = require('electron');
const { AgentClient } = require('@alune/agent-client/node');
module.exports = async ({ window, origin, repo, wait, pass }) => {
  await require('./smoke-window.cjs')(window);
  const wc = window.webContents;
  const ev = async (code) => {
    try {
      return await wc.executeJavaScript(code);
    } catch (cause) {
      throw Error('Settings renderer query failed: ' + code, { cause });
    }
  };
  const { element, button, textButton, click, input, select } =
    require('./candidate-ui-driver.cjs')(wc, wait);
  const original = wc.getURL(),
    saved = await ev('window.aluneWorkspace.load()');
  const git = (...args) =>
    execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  const facts = () => [
    git('rev-parse', 'HEAD'),
    git('show-ref'),
    git('ls-files', '--stage'),
    git('status', '--porcelain'),
    git('diff', '--binary'),
  ];
  const before = facts(),
    picker = dialog.showOpenDialog,
    request = AgentClient.prototype.request;
  const persisted = async () => JSON.parse(await ev('window.aluneWorkspace.load()')).state;
  const canonical = (p) =>
    process.platform === 'win32'
      ? fs.realpathSync.native(p).replaceAll('\\', '/')
      : fs.realpathSync.native(p);
  const open = async (page) => {
    await window.loadURL(origin + '/settings/' + page);
  };
  async function fact(check, message) {
    for (let i = 0; i < 250; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error(message);
  }
  async function dismiss(title) {
    await wait(wc, element('.feedback-dialog[open]'));
    assert.ok((await ev('(' + element('.feedback-dialog[open]') + ').innerText')).includes(title));
    await click(element('.feedback-dialog[open] [aria-label="关闭提示"]'));
    await wait(wc, '!(' + element('.feedback-dialog[open]') + ')');
  }
  try {
    await window.loadURL(origin + '/repositories');
    await click(button('打开本地仓库'));
    await wait(wc, element('#local-repo-path'));
    await input(element('#local-repo-path'), 'retained chooser draft');
    let picks = 0;
    dialog.showOpenDialog = async (owner, options) => {
      assert.equal(owner, window);
      assert.deepEqual(options.properties, ['openDirectory']);
      picks++;
      return { canceled: true, filePaths: [] };
    };
    await click(textButton('浏览', '.a-dlg-shell button'));
    await fact(() => picks === 1, 'workspace chooser was not called');
    assert.equal(await ev('(' + element('#local-repo-path') + ').value'), 'retained chooser draft');
    dialog.showOpenDialog = async (owner, options) => {
      assert.equal(owner, window);
      assert.deepEqual(options.properties, ['openDirectory']);
      picks++;
      return { canceled: false, filePaths: [repo] };
    };
    await click(textButton('浏览', '.a-dlg-shell button'));
    await wait(wc, '(' + element('#local-repo-path') + ')?.value===' + JSON.stringify(repo));
    assert.equal(
      await ev('(' + textButton('打开工作区', '.a-dlg-actions button') + ').disabled'),
      true,
    );
    assert.equal(picks, 2);
    await click(textButton('取消', '.a-dlg-actions button'));
    assert.deepEqual(facts(), before);
    await pass(
      ['UI-028', 'UI-025'],
      'native directory chooser cancellation retains the path draft; controlled selection fills the actual repository path without inspecting, registering or modifying Git',
    );

    await open('appearance');
    await wait(wc, element('#code-theme'));
    await click(element('input[value=system]'));
    if (await ev('(' + button('减少动态效果') + ').getAttribute("aria-checked")==="true"'))
      await click(button('减少动态效果'));
    await fact(async () => {
      const a = (await persisted()).appearance;
      return a?.theme === 'system' && !a?.reduceMotion;
    }, 'system appearance was not saved');
    assert.equal(wc.debugger.isAttached(), false);
    wc.debugger.attach('1.3');
    try {
      const emulate = (dark, reduced) =>
        wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
            { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
          ],
        });
      await emulate(false, false);
      await wait(
        wc,
        "document.documentElement.dataset.theme==='light'&&document.documentElement.dataset.reducedMotion==='false'",
      );
      const preferences = (await persisted()).appearance;
      await emulate(true, true);
      await wait(
        wc,
        "document.documentElement.dataset.theme==='dark'&&document.documentElement.dataset.reducedMotion==='true'",
      );
      assert.deepEqual((await persisted()).appearance, preferences);
      await emulate(false, false);
      await wait(
        wc,
        "document.documentElement.dataset.theme==='light'&&document.documentElement.dataset.reducedMotion==='false'",
      );
      assert.deepEqual((await persisted()).appearance, preferences);
      assert.deepEqual(facts(), before);
      await pass(
        ['UI-001', 'UI-055'],
        'renderer media-query changes update system theme and reduced motion in both directions without rewriting the saved system preferences or Git state',
      );
      await click(element('input[value=dark]'));
      await wait(wc, "document.documentElement.dataset.theme==='dark'");
      await emulate(false, true);
      await wait(
        wc,
        "document.documentElement.dataset.theme==='dark'&&document.documentElement.dataset.reducedMotion==='true'",
      );
      await pass(
        ['UI-001', 'UI-055'],
        'an explicit dark theme overrides an emulated light system preference while the renderer still honors reduced-motion media changes',
      );
    } finally {
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      wc.debugger.detach();
    }
    await wait(wc, "document.documentElement.dataset.theme==='dark'");
    await select('示例语言', 'Python');
    await wait(
      wc,
      "document.querySelector('.code-appearance-preview code')?.textContent.includes('dataclass')||document.querySelector('.code-appearance-preview .files-code')?.textContent.includes('dataclass')",
    );
    await select('示例语言', 'JSON');
    await wait(
      wc,
      "document.querySelector('.code-appearance-preview .files-code')?.textContent.includes('repositories')",
    );
    await input(element('#code-font-family'), '  Missing Acceptance Font  ');
    await wait(
      wc,
      '(' +
        element('#code-font-family') +
        ')?.getAttribute("value")==="  Missing Acceptance Font  "',
    );
    await ev('(' + element('#code-font-family') + ').blur()');
    await wait(wc, '(' + element('#code-font-family') + ')?.value==="Missing Acceptance Font"');
    const font = (await persisted()).codeAppearance.fontFamily;
    assert.equal(font, 'Missing Acceptance Font');
    await pass(
      ['UI-056'],
      'Python and JSON preview selectors render their actual samples; blurring a padded font name normalizes its displayed and persisted value',
    );
    async function importTheme(name, text) {
      await ev(
        `(()=>{const input=document.querySelector('input[aria-label="导入代码主题文件"]'),transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(text)}],${JSON.stringify(name)},{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    }
    const previousCode = (await persisted()).codeAppearance;
    await importTheme('invalid.json', '{ invalid theme');
    await dismiss('主题导入失败');
    assert.deepEqual((await persisted()).codeAppearance, previousCode);
    await importTheme(
      'acceptance.json',
      JSON.stringify({
        name: 'Acceptance Theme',
        type: 'dark',
        colors: { 'editor.background': '#203040' },
        tokenColors: [{ scope: 'keyword', settings: { foreground: '#c0ffee' } }],
      }),
    );
    await wait(wc, button('卸载 Acceptance Theme'));
    const installed = (await persisted()).codeAppearance.customThemes.find(
      (t) => t.name === 'Acceptance Theme',
    );
    assert.ok(installed);
    await click(textButton('恢复代码默认设置'));
    await fact(async () => {
      const c = (await persisted()).codeAppearance;
      return c.fontFamily !== font && c.customThemes.some((t) => t.id === installed.id);
    }, 'code reset did not retain installed themes');
    await select('代码主题', 'Acceptance Theme · 深色');
    await wait(
      wc,
      "getComputedStyle(document.querySelector('.code-appearance-preview .files-code')).backgroundColor==='rgb(32, 48, 64)'",
    );
    await click(button('卸载 Acceptance Theme'));
    await wait(wc, '!(' + button('卸载 Acceptance Theme') + ')');
    const removed = (await persisted()).codeAppearance;
    assert(!removed.customThemes.some((t) => t.id === installed.id));
    assert.notEqual(removed.darkTheme, installed.id);
    await open('appearance');
    await wait(wc, element('#code-theme'));
    assert(!(await persisted()).codeAppearance.customThemes.some((t) => t.id === installed.id));
    await pass(
      ['UI-056'],
      'invalid theme JSON reports an error without changing preferences; reset retains an imported theme, selecting it changes actual colors, and uninstalling the active theme falls back and stays removed after reload',
    );

    const valid = await ev('window.aluneWorkspace.load()'),
      corrupt = JSON.parse(valid);
    corrupt.state.codeAppearance.darkTheme = 'missing-acceptance-theme';
    await ev('window.aluneWorkspace.save(' + JSON.stringify(JSON.stringify(corrupt)) + ')');
    await open('appearance');
    await wait(wc, element('#code-theme'));
    await wait(
      wc,
      'document.querySelector(".feedback-dialog[open] #feedback-title")?.textContent.includes("代码外观配置已恢复")',
    );
    await click(textButton('知道了', '.feedback-dialog[open] button'));
    await wait(wc, '!(' + element('.feedback-dialog[open]') + ')');
    await click(element('button[aria-controls="feedback-inbox"]'));
    await wait(
      wc,
      '![...document.querySelectorAll(".fb-item")].some(e=>e.innerText.includes("代码外观配置已恢复"))',
    );
    assert.notEqual((await persisted()).codeAppearance.darkTheme, 'missing-acceptance-theme');
    assert.deepEqual(facts(), before);
    if (await ev('!!(' + button('关闭通知与提示') + ')')) await click(button('关闭通知与提示'));
    await pass(
      ['UI-056'],
      'a deliberately missing stored code theme recovers to a built-in theme; the notification action dismisses that recovery notice without modifying Git',
    );

    await open('logs');
    await wait(wc, element('#logging-directory'));
    const initial = {
      directory: await ev('(' + element('#logging-directory') + ').value'),
      level: await ev('(' + button('最低记录等级') + ').closest(".ant-select").innerText.trim()'),
      days: await ev('(' + button('保留天数') + ').value'),
      size: await ev('(' + button('总大小上限') + ').value'),
    };
    const actualDirectory = await ev('document.querySelector(".logging-path").textContent'),
      chosen = path.join(path.dirname(repo), 'chosen-logging-directory');
    fs.mkdirSync(chosen);
    let logPicks = 0;
    dialog.showOpenDialog = async (owner, options) => {
      assert.equal(owner, window);
      assert.deepEqual(options.properties, ['openDirectory', 'createDirectory']);
      logPicks++;
      return logPicks === 1
        ? { canceled: true, filePaths: [] }
        : { canceled: false, filePaths: [chosen] };
    };
    await click(textButton('选择目录…'));
    await fact(() => logPicks === 1, 'log chooser was not called');
    assert.equal(await ev('(' + element('#logging-directory') + ').value'), initial.directory);
    await click(textButton('选择目录…'));
    await wait(wc, '(' + element('#logging-directory') + ')?.value===' + JSON.stringify(chosen));
    let opened = [];
    AgentClient.prototype.request = function (method, ...args) {
      const result = request.call(this, method, ...args);
      return method === 'diagnostics.logs.settings'
        ? result.then((value) => {
            opened.push(value.settings.directory);
            return value;
          })
        : result;
    };
    await click(textButton('打开日志目录'));
    await fact(() => opened.length === 1, 'native open-directory endpoint was not called');
    assert.equal(canonical(opened[0]), canonical(actualDirectory));
    await pass(
      ['UI-058'],
      'log chooser cancellation preserves its draft; selecting a directory does not save it, and the real Open Directory IPC queries the persisted Agent log path; OS launch remains suppressed by smoke mode',
    );
    await select('最低记录等级', 'WARN · 只记录警告和错误');
    await click(textButton('保存设置'));
    await dismiss('日志设置已保存');
    await open('logs');
    await wait(wc, '(' + element('#logging-directory') + ')?.value===' + JSON.stringify(chosen));
    assert.ok(
      (await ev('(' + button('最低记录等级') + ').closest(".ant-select").textContent')).includes(
        'WARN',
      ),
    );
    const rejected = path.join(path.dirname(repo), 'not-a-logging-directory');
    fs.writeFileSync(rejected, 'keep file bytes\n');
    await input(element('#logging-directory'), rejected);
    await click(textButton('保存设置'));
    await dismiss('日志设置未保存');
    await open('logs');
    await wait(wc, '(' + element('#logging-directory') + ')?.value===' + JSON.stringify(chosen));
    assert.equal(fs.readFileSync(rejected, 'utf8'), 'keep file bytes\n');
    await click(textButton('恢复默认目录'));
    assert.equal(await ev('(' + element('#logging-directory') + ').value'), '');
    const defaultPath = await ev('(' + element('#logging-directory') + ').placeholder.slice(3)');
    await click(textButton('保存设置'));
    await dismiss('日志设置已保存');
    await open('logs');
    await wait(
      wc,
      'document.querySelector(".logging-path")?.textContent===' + JSON.stringify(defaultPath),
    );
    await pass(
      ['UI-058'],
      'log level and directory survive reload; saving a file as a directory fails without replacing settings or file bytes, and restoring the default directory persists',
    );
    await click(textButton('打开实时日志'));
    await fact(
      () =>
        BrowserWindow.getAllWindows().some(
          (w) => w !== window && w.webContents.getURL().startsWith(origin + '/logs'),
        ),
      'standalone log window was not opened',
    );
    const viewer = BrowserWindow.getAllWindows().find(
      (w) => w !== window && w.webContents.getURL().startsWith(origin + '/logs'),
    );
    await wait(viewer.webContents, "document.querySelector('.log-viewer__status--live')");
    await click(textButton('打开实时日志'));
    assert.equal(
      BrowserWindow.getAllWindows().filter(
        (w) => w !== window && w.webContents.getURL().startsWith(origin + '/logs'),
      ).length,
      1,
    );
    viewer.hide();
    await require('./smoke-window.cjs')(window);
    await input(element('#logging-directory'), initial.directory);
    await select('最低记录等级', initial.level);
    await input(button('保留天数'), initial.days);
    await input(button('总大小上限'), initial.size);
    await click(textButton('保存设置'));
    await dismiss('日志设置已保存');
    await pass(
      ['UI-058', 'UI-068'],
      'the settings entry opens a live standalone log window and reuses it on a second click; original logging settings are restored explicitly',
    );
    assert.deepEqual(facts(), before);
  } finally {
    dialog.showOpenDialog = picker;
    AgentClient.prototype.request = request;
    if (wc.debugger.isAttached()) {
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
      wc.debugger.detach();
    }
    await ev('window.aluneWorkspace.save(' + JSON.stringify(saved) + ')');
    await window.loadURL(original);
  }
};
