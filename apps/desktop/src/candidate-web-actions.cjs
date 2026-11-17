// Actual Vite/WS/Agent service with no desktop preload or supplied API mock.
// Clipboard writes are captured in this isolated browser window only.
const assert = require('node:assert/strict');
const { BrowserWindow } = require('electron');
const { randomUUID } = require('node:crypto');
module.exports = async ({ wait }) => {
  const address = process.env.ALUNE_TEST_WEB_URL;
  assert.ok(address);
  const origin = new URL(address).origin;
  const partition = 'alune-web-acceptance-' + randomUUID();
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 850,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition,
      backgroundThrottling: false,
    },
  });
  const wc = window.webContents,
    ev = async (code) => {
      try {
        return await wc.executeJavaScript(code);
      } catch (cause) {
        throw Error('Web renderer query failed: ' + code, { cause });
      }
    },
    children = [],
    external = [];
  const { element, button, textButton, click } = require('./candidate-ui-driver.cjs')(wc, wait);
  const { measure } = require('./candidate-ui-audit.cjs');
  wc.setWindowOpenHandler((details) => {
    const target = new URL(details.url);
    if (target.origin === origin && target.pathname === '/logs')
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            partition,
            backgroundThrottling: false,
          },
        },
      };
    external.push({ url: details.url, target: details.frameName });
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => children.push(child));
  const check = async (fn, label) => {
    for (let i = 0; i < 250; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error(label);
  };
  async function notice(text) {
    await wait(wc, element('.feedback-dialog[open]'));
    assert.ok((await ev('(' + element('.feedback-dialog[open]') + ').innerText')).includes(text));
    await click(element('.feedback-dialog[open] [aria-label="关闭提示"]'));
    await wait(wc, '!(' + element('.feedback-dialog[open]') + ')');
  }
  try {
    await window.loadURL(address).catch((error) => {
      throw Error(error.message.replaceAll(new URL(address).hash, '#<redacted>'));
    });
    await wait(wc, element('.app-shell'));
    await wait(wc,'location.pathname==="/repositories"&&document.body.innerText.includes("暂无仓库")');
    assert.equal(await ev('typeof window.aluneWorkspace'), 'undefined');
    assert.equal(await ev('typeof window.aluneLogs'), 'undefined');
    assert.equal(await ev('typeof window.require'), 'undefined');
    await ev(
      'history.pushState({},"","/settings/logs");window.dispatchEvent(new PopStateEvent("popstate"))',
    );
    await wait(wc, element('.logging-path'));
    const directory = await ev('document.querySelector(".logging-path").textContent');
    assert.ok(directory.includes('web-agent'));
    await ev(
      '(()=>{window.__clipboardWrites=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{window.__clipboardWrites.push(value)}}});return true})()',
    );
    await measure(
      wc,
      ['UI-058'],
      'Web without a desktop bridge copies the actual Agent log directory through the browser clipboard API and leaves the logging draft unchanged',
      async () => {
        const draft = await ev('document.querySelector("#logging-directory").value');
        await click(textButton('复制日志目录路径'));
        await notice('已复制日志目录路径');
        assert.deepEqual(await ev('window.__clipboardWrites'), [directory]);
        assert.equal(await ev('document.querySelector("#logging-directory").value'), draft);
      },
    );
    await measure(
      wc,
      ['UI-058'],
      'a controlled browser clipboard rejection shows the copy failure, retains the actual Agent directory and does not save logging settings',
      async () => {
        await ev(
          'navigator.clipboard.writeText=async()=>{throw Error("controlled clipboard failure")};void 0',
        );
        await click(textButton('复制日志目录路径'));
        await notice('复制失败，请手动选择路径文本复制');
        assert.equal(await ev('document.querySelector(".logging-path").textContent'), directory);
      },
    );
    await measure(
      wc,
      ['UI-058', 'UI-068'],
      'the Web log entry opens a live same-origin named log tab and a second click reuses that tab without a desktop bridge',
      async () => {
        await ev(
          'window.__logTabs=[];window.__originalWindowOpen=window.open;window.open=function(...args){const tab=window.__originalWindowOpen.apply(window,args);window.__logTabs.push(tab);return tab};void 0',
        );
        await wc.executeJavaScript('(' + textButton('打开实时日志') + ').click()', true);
        await check(() => children.length === 1, 'Web log tab was not opened');
        await wait(children[0].webContents, "document.querySelector('.log-viewer__status--live')");
        await wc.executeJavaScript('(' + textButton('打开实时日志') + ').click()', true);
        assert.equal(
          await ev('!!window.__logTabs[0]&&window.__logTabs[0]===window.__logTabs[1]'),
          true,
        );
        assert.equal(children.length, 1);
        assert.equal(new URL(children[0].webContents.getURL()).origin, origin);
      },
    );
    await measure(
      wc,
      ['UI-040', 'UI-050'],
      'Web workspace help emits the documented Wiki URL, closes navigation and returns focus; the controlled external target is denied instead of launching another application',
      async () => {
        await click(element('button.repository-switcher'));
        await wait(wc, button('帮助与文档'));
        assert.equal(await ev('(' + button('帮助与文档') + ').target'), '_blank');
        await wc.executeJavaScript('(' + button('帮助与文档') + ').click()', true);
        await check(() => external.length === 1, 'help target was not emitted');
        assert.equal(external[0].url, 'https://github.com/ShaoClean/Alune/wiki');
        assert.equal(external[0].target, '');
        await wait(
          wc,
          '!(' +
            element('.repository-switcher-panel') +
            ')&&document.activeElement?.classList.contains("repository-switcher")',
        );
      },
    );
    await measure(
      wc,
      ['UI-050'],
      'the Web status connection entry opens connection management for an empty local workspace without changing its log directory',
      async () => {
        await click(element('.status-button--connection'));
        await wait(wc, 'location.pathname==="/connections"');
        await ev(
          'history.pushState({},"","/settings/logs");window.dispatchEvent(new PopStateEvent("popstate"))',
        );
        // Navigation/cache refresh can replace this node between evaluations.
        // Read and compare the loaded path in the same renderer turn.
        await wait(wc, 'document.querySelector(".logging-path")?.textContent===' + JSON.stringify(directory));
      },
    );
    console.log(
      'Verified Web-only fallback acceptance: clipboard success/failure, named logs, help navigation and connection entry.',
    );
    return 5;
  } finally {
    for (const child of children) if (!child.isDestroyed()) child.destroy();
    if (!window.isDestroyed()) window.destroy();
  }
};
