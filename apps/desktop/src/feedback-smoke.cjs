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
  const originalAuthor = git('config', 'user.name').trim();
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
    await wait(
      "document.querySelector('[aria-label=拉取]').getAttribute('aria-disabled') !== 'true'",
    );
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
    await wait("document.querySelector('.diff-shell--fullscreen .feedback-tray:popover-open')");
    assert.equal(
      await execute(`(() => {
      const tray = document.querySelector('.feedback-tray'); const rect = tray.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.feedback-tray') === tray;
    })()`),
      true,
    );
    await click('.feedback-tray button');
    await wait(
      "document.querySelector('.feedback-dialog[open]')?.textContent.includes('通知与仓库说明')",
    );
    await execute(
      "document.querySelector('.feedback-dialog').dispatchEvent(new Event('cancel', { cancelable: true }))",
    );
    await wait("!document.querySelector('.feedback-dialog').open");
    await click('[aria-label="退出全屏查看"]');
    git('config', 'user.name', '');
    await click('[aria-label="刷新仓库"]');
    await wait(
      "document.querySelector('.feedback-list')?.textContent.includes('提交前需要设置作者')",
    );
    await click('[aria-label="全屏查看差异"]');
    await wait("document.querySelector('.diff-shell--fullscreen .feedback-tray:popover-open')");
    await click('.feedback-tray button');
    await execute(
      "Array.from(document.querySelectorAll('.feedback-list button')).find(button => button.textContent.includes('提交前需要设置作者')).click()",
    );
    await click('.feedback-actions .ant-btn-primary');
    await wait(
      "!document.querySelector('.diff-shell--fullscreen') && document.querySelector('#git-author-name')",
    );
    assert.equal(
      await execute(`(() => {
        const input = document.querySelector('#git-author-name'); const rect = input.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input;
      })()`),
      true,
    );
    assert.equal(await execute("document.querySelector('.feedback-dialog').open"), false);
    await click('.ant-modal-close');
    await wait(
      "!document.querySelector('.ant-modal-wrap') || getComputedStyle(document.querySelector('.ant-modal-wrap')).display === 'none'",
    );
    git('config', 'user.name', originalAuthor);
    await click('[aria-label="刷新仓库"]');
    window.setSize(390, 760);
    await wait(
      "document.querySelector('[aria-label=拉取]').getAttribute('aria-disabled') !== 'true'",
    );
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
      'Desktop feedback passed: real Git failure, layout/draft stability, copy, focus return, acknowledgement/retry, fullscreen notices and author action, and 390px window.',
    );
  } finally {
    await clipboard.writeText(oldClipboard);
    git('config', 'user.name', originalAuthor);
    window.setSize(...originalSize);
  }
};
