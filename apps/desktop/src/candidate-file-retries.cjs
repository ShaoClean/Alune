// Exercise real filesystem failures through FilesView's own retry controls.
// All files belong to the disposable native fixture; no production API is mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, id, repo, wait, pass }) => {
  const wc = window.webContents, ev = (code) => wc.executeJavaScript(code);
  const { button, textButton, click } = require('./candidate-ui-driver.cjs')(wc, wait);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD'), index = git('ls-files', '--stage');
  const original = wc.getURL(), directory = 'acceptance-file-retry';
  const folder = path.join(repo, directory), held = folder + '-held';
  const leaf = path.join(folder, 'retry.txt'), bytes = 'actual bytes after explicit retry\n';
  assert.equal(fs.existsSync(folder), false);
  assert.equal(fs.existsSync(held), false);
  fs.mkdirSync(folder);
  fs.writeFileSync(leaf, bytes);
  const item = (name) => "[...document.querySelectorAll('.files-tree__item')].find(e=>e.getClientRects().length&&e.querySelector('.files-tree__name')?.textContent===" + JSON.stringify(name) + ')';
  const retry = textButton('重试', '.feedback-dialog[open] button');
  const checkGit = () => {
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('ls-files', '--stage'), index);
  };
  try {
    await window.loadURL(origin + '/repositories/' + id);
    await click(button('文件'));
    await wait(wc, item(directory));
    // The directory existed in the listing but vanishes before it is expanded.
    fs.renameSync(folder, held);
    await click(item(directory));
    await wait(wc, retry);
    assert.ok(await ev('document.querySelector(".feedback-dialog[open]")?.textContent.includes(' + JSON.stringify(directory) + ')'));
    assert.equal(await ev('Boolean(' + item('retry.txt') + ')'), false);
    fs.renameSync(held, folder);
    await click(retry);
    await wait(wc, item('retry.txt'));
    assert.equal(fs.readFileSync(leaf, 'utf8'), bytes);
    checkGit();
    await pass(['UI-017'], 'a listed directory disappears before expansion; restoring its exact path and using its own directory retry reveals the actual child without changing HEAD or index');

    // The same stale-list race for an ordinary file exercises the complete
    // FilePreviewPane -> PreviewBody -> FilesNotice retry callback chain.
    fs.renameSync(leaf, leaf + '.held');
    await click(item('retry.txt'));
    await wait(wc, 'document.querySelector(".feedback-dialog[open] #feedback-title")?.textContent==="文件不存在"');
    fs.renameSync(leaf + '.held', leaf);
    await click(retry);
    await wait(wc, 'document.querySelector(".files-code__content")?.textContent.trim()===' + JSON.stringify(bytes.trim()));
    checkGit();
    assert.equal(fs.readFileSync(leaf, 'utf8'), bytes);
    await pass(['UI-017'], 'a selected file vanishes after directory listing; restoring its exact bytes and pressing the file preview retry recovers the selected path and content, preserving HEAD and index');

    await click(button('折叠全部文件夹'));
    await wait(wc, '!(' + item('retry.txt') + ')&&(' + item(directory) + ')?.getAttribute("aria-expanded")==="false"');
    await ev('(()=>{const e=(' + item(directory) + ');e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}))})()');
    await wait(wc, item('retry.txt'));
    await ev('(()=>{const e=(' + item(directory) + ');e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true,cancelable:true}))})()');
    await wait(wc, '!(' + item('retry.txt') + ')');
    assert.equal(await ev('document.querySelector(".files-code__content")?.textContent.trim()'), bytes.trim());
    checkGit();
    await pass(['UI-017'], 'collapse-all removes expanded children; the file tree ArrowRight and ArrowLeft callbacks reopen and collapse that same real directory while retaining selected file bytes and Git state');
  } finally {
    if (fs.existsSync(held)) fs.renameSync(held, folder);
    fs.rmSync(folder, { recursive: true, force: true });
    await window.loadURL(original);
  }
};
