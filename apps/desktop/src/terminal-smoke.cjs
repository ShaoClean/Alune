const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async ({ window, origin, token, backend }) => {
  const root = path.join(process.env.ALUNE_SMOKE_DIR, 'terminal 中文 workspace');
  fs.mkdirSync(root, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', root, ...args]);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Terminal Test');
  git('config', 'user.email', 'terminal@example.invalid');
  git('remote', 'add', 'origin', root);
  fs.writeFileSync(path.join(root, 'probe.txt'), 'ALUNE_DESKTOP_PTY_VERIFIED\n中文终端\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  git('config', 'branch.main.remote', 'origin');
  git('config', 'branch.main.merge', 'refs/heads/main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const repo = await (
    await fetch(origin + '/api/repositories', {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'local', path: root }),
    })
  ).json();
  assert.ok(repo.id);
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const until = async (source) => {
    const started = Date.now();
    while (!(await evaluate(source))) {
      if (Date.now() - started > 15000)
        throw new Error(
          'Terminal desktop check timed out: ' +
            source +
            '\n' +
            (await evaluate(
              "document.body.innerText + '\\nFOCUS: ' + document.activeElement?.outerHTML",
            )),
        );
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const send = async (text) => {
    await require('./smoke-window.cjs')(window);
    await evaluate('document.querySelector(\'button[aria-label="关闭提示"]\')?.click()');
    await evaluate("document.querySelector('.xterm-helper-textarea').focus()");
    for (const character of text) {
      const modifiers = /^[A-Z]$/.test(character) ? ['shift'] : [];
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: character, modifiers });
      window.webContents.sendInputEvent({ type: 'char', keyCode: character, modifiers });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: character, modifiers });
      // Give Chromium's input/composition handlers a turn between characters.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  };
  await window.loadURL(origin + '/repositories/' + repo.id);
  await until("!!document.querySelector('[data-terminal-toggle]')");
  await click('[data-terminal-toggle]');
  await until("document.querySelector('[data-terminal-new]')?.disabled === false");
  await click('[data-terminal-new]');
  await until("document.querySelector('.terminal-state')?.textContent === '运行中'");
  await require('./smoke-window.cjs')(window);
  await send(process.platform === 'win32' ? 'chcp 65001 > nul & type probe.txt' : 'cat probe.txt');
  await until(
    "document.querySelector('.xterm-accessibility')?.textContent.includes('ALUNE_DESKTOP_PTY_VERIFIED')",
  );
  assert.match(await evaluate("document.querySelector('.terminal-identity').textContent"), /本机/);
  assert.equal(
    await evaluate("document.querySelector('.terminal-path code').textContent"),
    fs.realpathSync(root),
  );

  await click('button[aria-label="收起终端"]');
  assert.equal(await evaluate("!!document.querySelector('.terminal-panel')"), false);
  await click('[data-terminal-toggle]');
  await until(
    "document.querySelector('.xterm-accessibility')?.textContent.includes('ALUNE_DESKTOP_PTY_VERIFIED')",
  );
  await click('button[aria-label="关闭终端 1"]');
  await until('!!document.querySelector(\'.a-dlg-shell[data-level="2"]\')');
  assert.equal(
    await evaluate("document.querySelector('.a-dlg-shell .ant-btn-primary')?.disabled"),
    true,
  );
  await until("document.activeElement.textContent.includes('取消')");
  await click('.a-dlg-shell input[type="checkbox"]');
  assert.equal(
    await evaluate("document.querySelector('.a-dlg-shell .ant-btn-primary')?.disabled"),
    false,
  );
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  assert.equal(await evaluate('!!document.querySelector(\'.a-dlg-shell[data-level="2"]\')'), true);
  await click('.a-dlg-shell .ant-btn-primary');
  await until("!document.querySelector('.terminal-tab')");

  await until("!document.querySelector('.a-dlg-shell')");

  // Exercise parser throughput and bounded history through the packaged renderer.
  await click('[data-terminal-new]');
  await until("document.querySelector('.terminal-state')?.textContent === '运行中'");
  await send(
    process.platform === 'win32'
      ? 'for /L %i in (1,1,12000) do @echo HISTORY_%i'
      : 'awk \'BEGIN { for (i=1;i<=12000;i++) print "HISTORY_" i }\'',
  );
  await until("document.querySelector('.xterm-accessibility')?.textContent.includes('HISTORY_12000')");
  await until("!!document.querySelector('.terminal-truncated')");
  if (process.platform !== 'win32') {
    await send('printf "\\033[?1049h\\033[2J\\033[HALTERNATE_SCREEN"');
    await until("document.querySelector('.xterm-accessibility')?.textContent.includes('ALTERNATE_SCREEN')");
    await send('printf "\\033[?1049l"');
    await until("document.querySelector('.xterm-accessibility')?.textContent.includes('HISTORY_12000')");
  }
  window.webContents.setZoomFactor(2);
  await until('document.documentElement.scrollWidth <= innerWidth');
  assert.ok(await evaluate("document.querySelector('.terminal-output').getBoundingClientRect().height > 0"));
  window.webContents.setZoomFactor(1);
  await send(process.platform === 'win32' ? 'exit /b 0' : 'exit 0');
  await until("document.querySelector('.terminal-state')?.textContent === '已退出 · 0'");
  await click('button[aria-label="关闭终端 1"]');
  await until("!document.querySelector('.terminal-tab')");

  // Main-process close has the same L2 contract and cancellation keeps the window.
  await click('[data-terminal-new]');
  await until("document.querySelector('.terminal-state')?.textContent === '运行中'");
  window.close();
  await until("document.body.innerText.includes('关闭 1 个终端并退出')");
  assert.equal(
    await evaluate("document.querySelector('.a-dlg-shell .ant-btn-primary')?.disabled"),
    true,
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.a-dlg-shell button')).find(b => b.textContent.replace(/\\s/g,'') === '取消').click()",
  );
  await until('!document.querySelector(\'.a-dlg-shell[data-level="2"]\')');
  assert.equal(window.isDestroyed(), false);
  await send(process.platform === 'win32' ? 'exit /b 7' : 'exit 7');
  await until("document.querySelector('.terminal-state')?.textContent === '已退出 · 7'");
  await click('button[aria-label="关闭终端 1"]');
  await until("!document.querySelector('.terminal-tab')");
  const registry = backend.get(require('./server/terminal/terminal-registry.js').TerminalRegistry);
  assert.equal(registry.entries.size, 0);
  console.log('TERMINAL_DESKTOP_SMOKE_OK', process.platform, process.arch);
};
