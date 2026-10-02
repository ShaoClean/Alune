import assert from 'node:assert/strict';

// Shared by browser and Electron; API responses are deterministic, UI/store are real.
export async function runQuietSuccessChecks(p, base = 'http://127.0.0.1:5188') {
  const results = [];
  for (const source of ['local', 'ssh']) {
    await p.goto(`${base}/tests/quiet-success-fixture.html?source=${source}`);
    await p.waitForFunction(() => !!window.quietProbe);
    await p.fill('input[aria-label="提交摘要"]', '保留提交草稿');
    await p.fill('input[aria-label="筛选改动文件"]', 'file-');
    let revision = 0;
    const operate = async (label, nextLabel, count) => {
      await p.click(`button[aria-label="${label}"]`);
      await p.waitForFunction(
        (expected) =>
          window.quietProbe().revision === expected &&
          !document.querySelector(
            'button[aria-label="全部暂存"]:disabled, button[aria-label="全部取消暂存"]:disabled',
          ),
        ++revision,
      );
      const state = await p.evaluate(() => ({
        ...window.quietProbe(),
        focus: document.activeElement.getAttribute('aria-label'),
        draft: document.querySelector('input[aria-label="提交摘要"]').value,
        query: document.querySelector('input[aria-label="筛选改动文件"]').value,
        modal: !!document.querySelector(
          'dialog:modal, .ant-message-notice, .ant-notification-notice',
        ),
        count: document.querySelector('.commit-box__heading').textContent,
      }));
      assert.equal(state.files.filter((file) => file.staged).length, count);
      assert.equal(state.reads, revision);
      assert.equal(state.writes, revision);
      assert.equal(state.published, 0);
      assert.equal(state.entries.length, 0);
      assert.equal(state.modal, false);
      assert.equal(state.focus, nextLabel);
      assert.equal(state.draft, '保留提交草稿');
      assert.equal(state.query, 'file-');
      assert.ok(state.count.includes(`${count} 个文件已暂存`));
    };
    for (let i = 0; i < 3; i++) {
      await operate('暂存 file-00.txt', '取消暂存 file-00.txt', 1);
      await operate('取消暂存 file-00.txt', '暂存 file-00.txt', 0);
    }
    await operate('全部暂存', '全部取消暂存', 30);
    await operate('全部取消暂存', '全部暂存', 0);
    // Trigger a mutation while the filter owns focus; scroll must not jump.
    const scroll = await p.evaluate(() => {
      const content = document.querySelector('.changes-content');
      content.style.maxHeight = '250px';
      content.style.overflow = 'auto';
      content.scrollTop = 100;
      document.querySelector('input[aria-label="筛选改动文件"]').focus({ preventScroll: true });
      document.querySelector('button[aria-label="暂存 file-20.txt"]').click();
      return content.scrollTop;
    });
    await p.waitForFunction((expected) => window.quietProbe().revision === expected, ++revision);
    const stable = await p.evaluate(() => ({
      scroll: document.querySelector('.changes-content').scrollTop,
      focus: document.activeElement.getAttribute('aria-label'),
      published: window.quietProbe().published,
    }));
    assert.equal(stable.scroll, scroll);
    assert.equal(stable.focus, '筛选改动文件');
    assert.equal(stable.published, 0);
    // Preserve the input caret, and never reclaim focus moved during the request.
    for (const moveFocus of [false, true]) {
      await p.evaluate((moveFocus) => {
        const input = document.querySelector('input[aria-label="提交摘要"]');
        const button = document.querySelector('button[aria-label="暂存 file-21.txt"]');
        (moveFocus ? button : input).focus({ preventScroll: true });
        input.setSelectionRange(2, 4);
        button.click();
        if (moveFocus) input.focus({ preventScroll: true });
      }, moveFocus);
      await p.waitForFunction(
        (expected) =>
          window.quietProbe().revision === expected &&
          !document.querySelector('input[aria-label="提交摘要"]').readOnly,
        ++revision,
      );
      const input = await p.evaluate(() => ({
        focus: document.activeElement.getAttribute('aria-label'),
        start: document.activeElement.selectionStart,
        end: document.activeElement.selectionEnd,
        published: window.quietProbe().published,
      }));
      assert.deepEqual(input, { focus: '提交摘要', start: 2, end: 4, published: 0 });
      await operate('取消暂存 file-21.txt', '暂存 file-21.txt', 1);
    }
    await p.click('#fail-next');
    await p.click('button[aria-label="暂存 file-00.txt"]');
    await p.waitForFunction(() =>
      document.querySelector('dialog:modal')?.textContent.includes('模拟 Git 写入失败'),
    );
    const failure = await p.evaluate(() => window.quietProbe());
    assert.equal(failure.entries.length, 1);
    assert.equal(failure.entries[0].type, 'error');
    assert.equal(failure.files.find((file) => file.path === 'file-00.txt').staged, false);
    await p.press('button[aria-label="关闭提示"]', 'Escape');
    await p.click('button[aria-label="丢弃 file-00.txt"]');
    await p.waitForFunction(() => document.body.textContent.includes('我确认丢弃未暂存改动'));
    results.push({
      source,
      operations: revision,
      successEvents: 0,
      errorFeedback: true,
      confirmation: true,
    });
  }
  return results;
}
