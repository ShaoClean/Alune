// Exercise two real PTYs through the mounted terminal. No OS clipboard,
// external command target, or Electron window focus change is needed.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
module.exports = async ({ wc, work, wait, element, button, click, primary, pass }) => {
  const file = path.join(work, 'terminal-probe.txt');
  const marker = 'PTY_CONTENT_' + require('node:crypto').randomUUID();
  fs.writeFileSync(file, marker + '\n');
  const ev = (s) => wc.executeJavaScript(s);
  const tab = '.terminal-tab [role=tab]',
    active = '.terminal-tab.is-active [role=tab]';
  const running = () =>
    wait(wc, "document.querySelector('.terminal-state')?.textContent==='运行中'");
  const output = (t) =>
    "document.querySelector('.terminal-output .xterm-accessibility')?.textContent.includes(" +
    JSON.stringify(t) +
    ')';
  const key = (expr, key, code, n) =>
    wait(
      wc,
      `(()=>{const e=(${expr});if(!e)return false;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key, code, keyCode: n, which: n, bubbles: true, cancelable: true })}));return true;})()`,
    );
  async function send(line) {
    await wait(
      wc,
      `(()=>{const el=document.querySelector('.terminal-output .xterm-helper-textarea');if(!el)return false;el.focus();const d=new DataTransfer();d.setData('text/plain',${JSON.stringify(line)});el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));return true;})()`,
    );
    await key(element('.terminal-output .xterm-helper-textarea'), 'Enter', 'Enter', 13);
  }
  await click(element('[data-terminal-toggle]'));
  await click(button('新建终端'));
  await running();
  assert.equal(await ev("document.querySelector('.terminal-identity > span').title"), '本机');
  assert.equal(
    await ev("document.querySelector('.terminal-path code').textContent"),
    fs.realpathSync.native(work),
  );
  await send(process.platform === 'win32' ? 'type terminal-probe.txt' : 'cat terminal-probe.txt');
  await wait(wc, output(marker));
  const first = await ev(
    'document.querySelector(' + JSON.stringify(active) + ").getAttribute('aria-controls')",
  );
  await click(button('最大化终端'));
  await wait(wc, button('还原终端'));
  await click(button('还原终端'));
  await click(button('收起终端'));
  await wait(wc, "!document.querySelector('.terminal-panel')");
  await click(element('[data-terminal-toggle]'));
  await wait(wc, output(marker));
  await pass(
    ['UI-046'],
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
  await key(element(active), 'Home', 'Home', 36);
  await wait(wc, output(marker));
  await key(element(active), 'End', 'End', 35);
  await wait(
    wc,
    `document.querySelector('${active}')?.getAttribute('aria-controls')===${JSON.stringify(second)} && document.querySelector('.terminal-output .xterm-accessibility') && !(${output(marker)})`,
  );
  await click(button('全部终端会话'));
  await wait(wc, "document.querySelectorAll('.terminal-all-sessions li').length===2");
  await click(element('.terminal-all-sessions li:first-child button'));
  await wait(wc, output(marker));
  await click(button('关闭终端 1'));
  await wait(wc, '(' + primary('关闭会话') + ')?.disabled===true');
  await click(primary('取消'));
  await wait(wc, '!(' + primary('关闭会话') + ')');
  assert.equal(await ev('document.querySelectorAll(' + JSON.stringify(tab) + ').length'), 2);
  for (const n of [2, 1]) {
    await click(button('关闭终端 1'));
    await click(element('.a-dlg-shell input[type=checkbox]'));
    await click(primary('关闭会话'));
    await wait(
      wc,
      `document.querySelectorAll('${tab}').length===${n - 1}&&!(${primary('关闭会话')})`,
    );
  }
  await pass(
    ['UI-046'],
    'two PTYs have distinct output; Home/End and all-sessions switch ownership; cancel preserves both and explicit acknowledgement closes each separately',
  );
  await click(button('收起终端'));
  fs.unlinkSync(file);
};
