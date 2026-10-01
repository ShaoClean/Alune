// Browser regression shared by ego-browser and the Electron renderer smoke.
// Start Vite on 5188, then invoke runFeedbackChecks(page) on an isolated page.
import assert from 'node:assert/strict';
export async function runFeedbackChecks(
  p,
  url = 'http://127.0.0.1:5188/tests/feedback-fixture.html',
) {
  await p.goto(url);
  await p.waitForSelector('#queue');
  await p.evaluate(() => {
    document.querySelector('#workspace').scrollTop = 100;
  });
  const bounds = () => ({
    rect: document.querySelector('#workspace').getBoundingClientRect().toJSON(),
    scroll: document.querySelector('#workspace').scrollTop,
  });
  const before = await p.evaluate(bounds);
  await p.click('#queue');
  const seen = [];
  for (const title of ['没有写入权限', 'Diff 不完整', '配置已保存', '能力限制说明']) {
    await p.waitForFunction(
      (title) =>
        document.querySelector('dialog:modal #feedback-title')?.textContent.includes(title),
      title,
    );
    const current = await p.evaluate(() => ({
      title: document.querySelector('#feedback-title').textContent,
      count: document.querySelectorAll('dialog:modal').length,
      toast: document.querySelectorAll('.ant-message-notice').length,
    }));
    assert.equal(current.count, 1);
    assert.equal(current.toast, 0);
    seen.push(current.title);
    await p.press('button[aria-label="关闭提示"]', 'Escape');
  }
  await p.waitForFunction(() => !document.querySelector('dialog:modal'));
  assert.deepEqual(await p.evaluate(bounds), before);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'queue');
  await p.click('#form');
  await p.fill('#draft', '保留此草稿 148');
  await p.click('#rich');
  await p.waitForFunction(() =>
    document.querySelector('.ant-modal-title')?.textContent.includes('保存失败'),
  );
  assert.equal(await p.evaluate(() => document.querySelectorAll('dialog:modal').length), 0);
  assert.equal(
    await p.evaluate(
      () =>
        [...document.querySelectorAll('.ant-modal-wrap')].filter((n) => n.getClientRects().length)
          .length,
    ),
    1,
  );
  await p.click('text="返回"');
  await p.waitForFunction(() =>
    document.querySelector('.ant-modal-title')?.textContent.includes('第二条提示'),
  );
  assert.equal(
    await p.evaluate(() => document.querySelector('.feedback-description code')?.textContent),
    'context',
  );
  await p.click('text="重试"');
  await p.waitForFunction(() =>
    document.querySelector('.ant-modal-title')?.textContent.includes('配置表单'),
  );
  assert.equal(await p.evaluate(() => document.querySelector('#draft').value), '保留此草稿 148');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'rich');
  await p.click('button[aria-label="关闭"]');
  await p.waitForFunction(
    () => ![...document.querySelectorAll('.ant-modal-wrap')].some((n) => n.getClientRects().length),
  );
  await p.click('#progress');
  await p.waitForFunction(() =>
    document.querySelector('dialog:modal #feedback-title')?.textContent.includes('Git 操作进行中'),
  );
  await p.press('button[aria-label="关闭提示"]', 'Escape');
  await p.click('#tick');
  await p.click('#tick');
  assert.equal(await p.evaluate(() => document.querySelector('dialog').open), false);
  assert.equal(await p.evaluate(() => document.querySelector('#tick-value').textContent), '2');
  await p.click('#switch');
  await p.waitForFunction(
    () => !document.querySelector('.feedback-inbox')?.textContent.includes('Git 操作进行中'),
  );
  await p.click('#file');
  await p.waitForFunction(() =>
    document.querySelector('dialog:modal #feedback-title')?.textContent.includes('二进制文件'),
  );
  const text = await p.evaluate(() => document.querySelector('dialog:modal').textContent);
  assert.match(text, /4\.0 KB/);
  assert.match(text, /binary.bin/);
  assert.match(text, /不提供文本预览/);
  assert.equal(
    await p.evaluate(
      () => document.querySelectorAll('.ant-alert,.files-notice,.git-operation-notice').length,
    ),
    0,
  );
  await p.press('button[aria-label="关闭提示"]', 'Escape');
  for (const [kind, title, detail] of [
    ['too-large', '文件过大', '预览上限'],
    ['unsupported-encoding', '不支持的文本编码', 'GBK'],
    ['symlink', '符号链接', '../shared/config.json'],
    ['403', '没有读取权限', '读取失败完整原因'],
    ['404', '文件不存在', '读取失败完整原因'],
  ]) {
    await p.evaluate((kind) => {
      const node = document.querySelector('#preview-case');
      node.value = kind;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, kind);
    await p.waitForFunction(
      (title) =>
        document.querySelector('dialog:modal #feedback-title')?.textContent.includes(title),
      title,
    );
    assert.ok(
      (await p.evaluate(() => document.querySelector('dialog:modal').textContent)).includes(detail),
    );
    if (kind === '404') {
      await p.click('text="重试"');
      await p.waitForFunction(() => !document.querySelector('dialog:modal'));
    } else await p.press('button[aria-label="关闭提示"]', 'Escape');
  }
  await p.click('#permissions');
  await p.waitForFunction(() =>
    document
      .querySelector('dialog:modal #feedback-title')
      ?.textContent.includes('PR/MR 操作权限受限'),
  );
  const permissionText = await p.evaluate(() => document.querySelector('dialog:modal').textContent);
  assert.match(permissionText, /没有写入权限/);
  assert.match(permissionText, /应用到此仓库/);
  assert.equal(permissionText.match(/没有写入权限/g).length, 1);
  await p.press('button[aria-label="关闭提示"]', 'Escape');
  return {
    seen,
    layoutAndScroll: 'stable',
    focus: 'restored',
    draft: 'preserved',
    hostDialogs: 1,
    polling: 'deduplicated',
    navigation: 'released',
    richContent: 'preserved',
  };
}
