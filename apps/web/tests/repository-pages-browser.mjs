import assert from 'node:assert/strict';

export async function runRepositoryPagesChecks(page, base = 'http://127.0.0.1:5173') {
  const text = selector => page.evaluate(selector => document.querySelector(selector)?.textContent ?? '', selector);
  await page.goto(`${base}/tests/repository-pages-fixture.html`);
  await page.waitForSelector('button[aria-label="暂存 src/App.tsx"]');
  await page.fill('input[placeholder="筛选文件…"]', 'App');
  await page.click('button[aria-label="暂存 src/App.tsx"]');
  await page.waitForFunction(() => !!document.querySelector('button[aria-label="取消暂存 src/App.tsx"]'));
  await page.click('button[aria-label="文件"]');
  await page.click('[role="treeitem"][title="src"]');
  await page.click('[role="treeitem"][title="src/App.tsx"]');
  await page.waitForSelector('.files-preview__body code');
  await page.click('button[aria-label="隐藏工作区文件"]');
  await page.waitForSelector('[role="tree"]', { state: 'hidden' });
  assert.equal(await page.evaluate(() => {
    const panel = document.querySelector('.files-view');
    return panel.clientWidth === panel.querySelector('.files-view__preview').clientWidth
      && !panel.querySelector('[role="separator"]');
  }), true);
  assert.equal(await text('.files-preview__body code'), 'fixture');
  await page.press('button[aria-label="显示工作区文件"]', 'Enter');
  await page.waitForSelector('[role="treeitem"][title="src/App.tsx"][aria-selected="true"]');
  await page.click('button[aria-label="隐藏工作区文件"]');
  await page.reload();
  await page.click('button[aria-label="文件"]');
  await page.click('button[aria-label="显示工作区文件"]');
  await page.waitForSelector('[role="treeitem"][title="src"]');
  await page.click('[aria-label="Diff 视图"] label >> nth=1');
  await page.waitForSelector('[aria-label="分栏差异"]');
  assert.match(await text('[aria-label="分栏差异"]'), /old[\s\S]*new/);
  await page.click('button[aria-label="全屏查看差异"]');
  await page.waitForSelector('dialog:modal[aria-label="src/App.tsx · 全屏查看"]');
  await page.press('dialog:modal', 'Escape');
  await page.waitForFunction(() => !document.querySelector('dialog:modal') && document.querySelector('.diff-shell')?.getAttribute('role') === 'region');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '全屏查看差异');
  await page.click('[aria-label="Diff 视图"] label >> nth=0');
  await page.waitForSelector('[aria-label="统一差异"]');
  assert.match(await text('[aria-label="统一差异"]'), /old[\s\S]*new/);
  await page.goto(`${base}/tests/repository-pages-fixture.html`);
  await page.waitForSelector('button[aria-label="暂存 src/App.tsx"]');
  await page.click('#fail-stage');
  await page.click('button[aria-label="暂存 src/App.tsx"]');
  await page.waitForFunction(() => document.querySelector('dialog:modal')?.textContent?.includes('模拟暂存失败'));
  assert.match(await text('dialog:modal'), /模拟暂存失败/);
  await page.press('dialog:modal', 'Escape');
  await page.waitForFunction(() => !document.querySelector('dialog:modal'));
  assert.equal(await page.evaluate(() => !!document.querySelector('button[aria-label="暂存 src/App.tsx"]')), true);
  return { stage: 'selected file becomes staged', navigation: 'file panel opens',
    diff: 'split/unified retain both sides; native Escape exits fullscreen and restores focus',
    error: 'failed stage leaves the original unstaged action available after dismissal' };
}
