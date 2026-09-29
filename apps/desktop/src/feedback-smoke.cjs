const assert = require('node:assert/strict');
const { clipboard } = require('electron');

// Runs against a real local Git repository and the staged Electron renderer.
module.exports = async ({ window, git, repo }) => {
  const { writeFileSync } = require('node:fs');
  const { join } = require('node:path');
  const execute = (script, gesture = false) =>
    window.webContents.executeJavaScript(script, gesture);
  const wait = (condition) =>
    execute(`new Promise((resolve, reject) => {
    const start = Date.now(); const check = () => {
      if (${condition}) return resolve();
      if (Date.now() - start > 10000) return reject(Error('Feedback smoke: ' + ${JSON.stringify(condition)} + ' | ' + JSON.stringify({dialog:document.querySelector('.feedback-dialog')?.innerText,pull:document.querySelector('[aria-label=拉取]')?.outerHTML})));
      setTimeout(check, 30);
    }; check();
  })`);
  const click = (selector) =>
    execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const originalSize = window.getSize();
  const oldClipboard = await clipboard.readText();
  try {
    git('remote', 'add', 'origin', '/demo/unavailable-alune.git');
    git('config', 'branch.native-feature.remote', 'origin');
    git('config', 'branch.native-feature.merge', 'refs/heads/main');
    writeFileSync(join(repo, 'first.txt'), 'feedback acceptance\n');
    await click('[aria-label="刷新仓库"]');
    await wait('document.querySelector(\'[aria-label="查看差异 first.txt（未暂存）"]\')');
    await click('[aria-label="查看差异 first.txt（未暂存）"]');
    await wait("document.querySelector('.diff-code-row--add')");
    await execute(`(() => {
      const input = document.querySelector('[aria-label="提交摘要"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '保留草稿');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[aria-label="拉取"]').focus();
    })()`);
    const bounds = await execute(
      "document.querySelector('.workspace-body').getBoundingClientRect().toJSON()",
    );
    await click('[aria-label="拉取"]');
    await wait(
      "document.querySelector('.feedback-dialog[open]')?.textContent.includes('Git 操作未完成')",
    );
    assert.deepEqual(
      await execute("document.querySelector('.workspace-body').getBoundingClientRect().toJSON()"),
      bounds,
    );
    assert.equal(
      await execute("document.querySelector('[aria-label=提交摘要]').value"),
      '保留草稿',
    );
    // Keep the smoke window visible for subsequent animation-frame/drag checks.
    window.show();
    window.focus();
    await wait('document.hasFocus()');
    await execute("document.querySelector('.feedback-actions button').click()", true);
    await wait("document.querySelector('.feedback-dialog').textContent.includes('已复制')");
    assert.match(await clipboard.readText(), /Git 操作未完成/);
    await execute(
      "document.querySelector('.feedback-dialog').dispatchEvent(new Event('cancel', { cancelable: true }))",
    );
    await wait("!document.querySelector('.feedback-dialog').open");
    assert.equal(await execute("document.activeElement.getAttribute('aria-label')"), '拉取');
    await click('[aria-label="刷新仓库"]');
    await wait(
      "document.querySelector('[aria-label=刷新仓库]').getAttribute('aria-busy') !== 'true'",
    );
    assert.equal(await execute("document.querySelector('.feedback-dialog').open"), false);
    await wait("document.querySelector('[aria-label=拉取]').getAttribute('aria-disabled') !== 'true'");
    // A delayed failure can arrive while the Diff occupies the native top layer.
    await execute(
      "document.querySelector('[aria-label=拉取]').click(); document.querySelector('[aria-label=全屏查看差异]').click()",
    );
    await wait("document.querySelector('.feedback-dialog[open]')");
    assert.equal(await execute("document.querySelectorAll('dialog:modal').length"), 2);
    assert.equal(
      await execute(
        "document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest('dialog').className",
      ),
      'feedback-dialog',
    );
    await execute(
      "document.querySelector('.feedback-dialog').dispatchEvent(new Event('cancel', { cancelable: true }))",
    );
    await wait("!document.querySelector('.feedback-dialog').open");
    assert.equal(await execute("document.querySelectorAll('dialog:modal').length"), 1);
    await click('[aria-label="退出全屏查看"]');
    window.setSize(390, 760);
    await wait("document.querySelector('[aria-label=拉取]').getAttribute('aria-disabled') !== 'true'");
    await click('[aria-label="拉取"]');
    await wait("document.querySelector('.feedback-dialog[open]')");
    assert.equal(
      await execute(
        "(() => {const r = document.querySelector('.feedback-dialog').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;})()",
      ),
      true,
    );
    await click('.feedback-actions button:last-child');
    await wait("!document.querySelector('.feedback-dialog').open");
    console.log(
      'Desktop feedback passed: real Git failure, layout/draft stability, copy, focus return, acknowledgement/retry, fullscreen top layer and 390px window.',
    );
  } finally {
    await clipboard.writeText(oldClipboard);
    window.setSize(...originalSize);
  }
};
