// Exercise two real PTYs through the mounted terminal. No OS clipboard,
// external command target is used. Escape activates the isolated smoke window.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
module.exports = async ({ wc, work, wait, element, button, click, primary, pass }) => {
  const file = path.join(work, 'terminal-probe.txt');
  const marker = 'PTY_CONTENT_' + require('node:crypto').randomUUID();
  fs.writeFileSync(file, marker + '\n');
  const ev = (s) => wc.executeJavaScript(s);
  await require('./smoke-window.cjs')(require('electron').BrowserWindow.fromWebContents(wc));
  const { pressKey } = require('./candidate-ui-driver.cjs')(wc, wait);
  const tab = '.terminal-tab [role=tab]',
    active = '.terminal-tab.is-active [role=tab]';
  const running = () =>
    wait(wc, "document.querySelector('.terminal-state')?.textContent==='运行中'");
  const output = (t) =>
    "document.querySelector('.terminal-output .xterm-accessibility')?.textContent.includes(" +
    JSON.stringify(t) +
    ')';
  async function retainedOutput() {
    // The accessibility tree represents the viewport, not the scrollback.
    // Long packaged runtime paths can scroll the probe off screen. Reveal the
    // retained history through the real terminal before asserting its bytes.
    // Mounting/refitting the retained xterm can still be in flight when the
    // panel appears. Move the native pointer over its current screen and keep
    // scrolling until Chromium has delivered the wheel and xterm has rendered.
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await ev(output(marker))) return;
      const point = await ev("(()=>{const e=document.querySelector('.terminal-output .xterm-screen');if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null})()");
      if (point) {
        wc.sendInputEvent({ type: 'mouseMove', ...point });
        wc.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: -10000, deltaX: 0 });
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await wait(wc, output(marker));
  }
  const key = (expr, key, code, n, modifiers = {}) =>
    wait(
      wc,
      `(()=>{const e=(${expr});if(!e)return false;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key, code, keyCode: n, which: n, bubbles: true, cancelable: true, ...modifiers })}));return true;})()`,
    );
  async function send(line) {
    await wait(
      wc,
      `(()=>{const el=document.querySelector('.terminal-output .xterm-helper-textarea');if(!el)return false;el.focus();const d=new DataTransfer();d.setData('text/plain',${JSON.stringify(line)});el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));return true;})()`,
    );
    await key(element('.terminal-output .xterm-helper-textarea'), 'Enter', 'Enter', 13);
  }
  await click(element('[data-terminal-toggle]'));
  await click(element('.terminal-empty button'));
  await running();
  assert.equal(await ev("document.querySelector('.terminal-identity > span').title"), '本机');
  assert.equal(
    fs.realpathSync.native(await ev("document.querySelector('.terminal-path code').textContent")),
    fs.realpathSync.native(work),
  );
  await send(process.platform === 'win32' ? 'type terminal-probe.txt' : 'cat terminal-probe.txt');
  await wait(wc, output(marker));
  const resize = button('调整终端高度');
  const height = () => ev('Number((' + resize + ').getAttribute("aria-valuenow"))');
  const originalHeight = await height();
  const dimensionsFile = path.join(work, 'terminal-dimensions.json');
  const runtimeRoot = require('electron').app.isPackaged
    ? path.join(process.resourcesPath, 'agent-runtime')
    : path.resolve(__dirname, '../agent-runtime');
  const node = path.join(
    runtimeRoot,
    process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node',
  );
  async function dimensions() {
    fs.rmSync(dimensionsFile, { force: true });
    await send(
      JSON.stringify(node.replaceAll('\\', '/')) +
        ` -e "require('node:fs').writeFileSync('terminal-dimensions.json',JSON.stringify({cols:process.stdout.columns,rows:process.stdout.rows}))"`,
    );
    const end = Date.now() + 15000;
    let actual;
    while (!actual && Date.now() < end) {
      try {
        actual = JSON.parse(fs.readFileSync(dimensionsFile, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (!actual) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(actual, 'the shell must run the dimensions probe');
    assert.ok(Number.isInteger(actual.rows) && actual.rows > 0);
    assert.ok(Number.isInteger(actual.cols) && actual.cols > 0);
    return actual;
  }
  await key(resize, 'Home', 'Home', 36);
  await wait(
    wc,
    '(' +
      resize +
      ')?.getAttribute("aria-valuenow")==(' +
      resize +
      ')?.getAttribute("aria-valuemin")',
  );
  const small = await dimensions();
  const smallRendered = await ev("document.querySelector('.terminal-emulator').clientHeight");
  await key(resize, 'End', 'End', 35);
  await wait(wc, 'Number((' + resize + ')?.getAttribute("aria-valuenow"))>' + originalHeight);
  // The React store updates before ResizeObserver delivers the measured xterm
  // dimensions. Wait for the actual viewport and rendered frames before asking
  // a new shell command to observe its PTY size.
  await wait(wc, "document.querySelector('.terminal-emulator').clientHeight>" + smallRendered);
  await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const large = await dimensions();
  assert.ok(large.rows > small.rows, 'the real PTY must receive the rendered terminal resize: ' + JSON.stringify({small, large, smallRendered, largeRendered: await ev("document.querySelector('.terminal-emulator').clientHeight")}));
  const point = await ev(
    '(()=>{const r=(' +
      resize +
      ').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()',
  );
  const to = point.y + (await height()) - originalHeight;
  wc.sendInputEvent({ type: 'mouseMove', ...point });
  wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1, modifiers: ['leftbuttondown'] });
  try {
    await wait(wc, '!!(' + resize + ')?.dataset.start');
    wc.sendInputEvent({
      type: 'mouseMove',
      x: point.x,
      y: to,
      button: 'left',
      modifiers: ['leftbuttondown'],
    });
    try {
      await wait(wc, 'Number((' + resize + ')?.getAttribute("aria-valuenow"))===' + originalHeight);
    } catch (error) {
      throw new Error(error.message + ' | resize: ' + JSON.stringify({ point, to, originalHeight,
        current: await height(), start: await ev('(' + resize + ')?.dataset.start') }));
    }
  } finally {
    wc.sendInputEvent({ type: 'mouseUp', x: point.x, y: to, button: 'left', clickCount: 1 });
    fs.rmSync(dimensionsFile, { force: true });
  }
  await retainedOutput();
  await pass(
    ['UI-046', 'UI-074', 'UI-042'],
    'terminal keyboard limits change actual PTY rows; native pointer drag restores the original height and retains output',
  );
  const { counts } = require('./candidate-ui-audit.cjs');
  const inputCallback = 'ui-listener:apps/web/src/stores/terminalStore.ts:terminal.onData:162';
  const inputCount = (await counts(wc)).get(inputCallback) ?? 0;
  await key(element('.terminal-output .xterm-helper-textarea'), 'F6', 'F6', 117, {
    ctrlKey: true,
    shiftKey: true,
  });
  await wait(wc, 'document.activeElement?.matches("[data-terminal-new]")');
  await key(element('.terminal-output .xterm-helper-textarea'), '`', 'Backquote', 192, {
    ctrlKey: true,
  });
  await wait(wc, '!document.querySelector(".terminal-panel")');
  await click(element('[data-terminal-toggle]'));
  await retainedOutput();
  assert.equal((await counts(wc)).get(inputCallback) ?? 0, inputCount);
  await pass(
    ['UI-074', 'UI-046', 'UI-025'],
    'terminal Ctrl+Shift+F6 leaves shell input for its create control; Ctrl+Backquote toggles the panel, preserves its output and sends neither shortcut to the real PTY input callback',
  );
  const first = await ev(
    'document.querySelector(' + JSON.stringify(active) + ").getAttribute('aria-controls')",
  );
  await click(button('最大化终端'));
  await wait(wc, button('还原终端'));
  await click(button('还原终端'));
  await click(button('收起终端'));
  await wait(wc, "!document.querySelector('.terminal-panel')");
  await click(element('[data-terminal-toggle]'));
  await retainedOutput();
  await pass(
    ['UI-046', 'UI-042'],
    'real terminal renders file bytes from its registered Git directory; maximize, restore and collapse retain the session output',
  );
  await click(button('新建终端'));
  await wait(wc, `document.querySelectorAll('${tab}').length===2`);
  await running();
  await wait(
    wc,
    `document.querySelector('${active}')?.getAttribute('aria-controls')!==${JSON.stringify(first)}`,
  );
  const second = await ev(
    'document.querySelector(' + JSON.stringify(active) + ").getAttribute('aria-controls')",
  );
  assert.notEqual(second, first);
  await wait(wc, element('.terminal-output .xterm-accessibility'));
  assert.ok(!(await ev(output(marker))));
  await click(element('.terminal-tab:not(.is-active) [role=tab]'));
  await retainedOutput();
  await click(element('.terminal-tab:not(.is-active) [role=tab]'));
  await wait(
    wc,
    `document.querySelector('${active}')?.getAttribute('aria-controls')===${JSON.stringify(second)} && !(${output(marker)})`,
  );
  await key(element(active), 'Home', 'Home', 36);
  await retainedOutput();
  await key(element(active), 'End', 'End', 35);
  await wait(
    wc,
    `document.querySelector('${active}')?.getAttribute('aria-controls')===${JSON.stringify(second)} && document.querySelector('.terminal-output .xterm-accessibility') && !(${output(marker)})`,
  );
  await click(button('全部终端会话'));
  await wait(wc, "document.querySelectorAll('.terminal-all-sessions li').length===2");
  await pressKey(element('.terminal-all-sessions button'), 'Escape');
  await wait(
    wc,
    "![...document.querySelectorAll('.terminal-all-sessions')].some(e=>e.getClientRects().length)",
  );
  assert.equal(await ev(`document.querySelectorAll('${tab}').length`), 2);
  await click(button('全部终端会话'));
  await click(element('.terminal-all-sessions li:first-child button'));
  await retainedOutput();
  await click(button('关闭终端 1'));
  await wait(wc, '(' + primary('关闭会话') + ')?.disabled===true');
  await click(primary('取消'));
  await wait(wc, '!(' + primary('关闭会话') + ')');
  assert.equal(await ev('document.querySelectorAll(' + JSON.stringify(tab) + ').length'), 2);
  await click(button('全部终端会话'));
  await click(button('关闭会话 2'));
  await click(element('.a-dlg-shell input[type=checkbox]'));
  await click(primary('关闭会话'));
  await wait(
    wc,
    "document.querySelectorAll('.terminal-all-sessions li').length===1&&!(" +
      primary('关闭会话') +
      ')',
  );
  await pressKey(element('.terminal-all-sessions button'), 'Escape');
  await wait(
    wc,
    "![...document.querySelectorAll('.terminal-all-sessions')].some(e=>e.getClientRects().length)",
  );
  await click(button('关闭终端 1'));
  await click(element('.a-dlg-shell input[type=checkbox]'));
  await click(primary('关闭会话'));
  await wait(wc, `document.querySelectorAll('${tab}').length===0&&!(${primary('关闭会话')})`);
  await pass(
    ['UI-046'],
    'two PTYs have distinct output; Home/End and all-sessions switch ownership; cancel preserves both and explicit acknowledgement closes each separately',
  );
  for (let count = 1; count <= 8; count++) {
    await click(button('新建终端'));
    await wait(wc, `document.querySelectorAll('${tab}').length===${count}`);
    await running();
  }
  assert.equal(await ev('(' + button('新建终端') + ').disabled'), true);
  assert.equal(
    await ev(
      `new Set([...document.querySelectorAll('${tab}')].map(e=>e.getAttribute('aria-controls'))).size`,
    ),
    8,
  );
  await click(button('全部终端会话'));
  await wait(wc, "document.querySelectorAll('.terminal-all-sessions li').length===8");
  for (let count = 8; count > 0; count--) {
    await click(button('关闭会话 1'));
    await click(element('.a-dlg-shell input[type=checkbox]'));
    await click(primary('关闭会话'));
    await wait(
      wc,
      `document.querySelectorAll('.terminal-all-sessions li').length===${count - 1}&&!(${primary('关闭会话')})`,
    );
  }
  await pressKey(element('.a-dlg-shell [aria-label="关闭"]'), 'Escape');
  await wait(
    wc,
    "![...document.querySelectorAll('.terminal-all-sessions')].some(e=>e.getClientRects().length)",
  );
  assert.equal(await ev(`document.querySelectorAll('${tab}').length`), 0);
  await pass(
    ['UI-046'],
    'eight distinct real PTYs disable the ninth create control; the global session list explicitly closes each and releases every tab',
  );
  await click(button('收起终端'));
  fs.unlinkSync(file);
};
