// Browser acceptance for #234, run by the Electron renderer smoke.
// Start Vite on 5188, then invoke runFindChecks(page) on an isolated page.
// `page.key(key, modifiers)` must send real key events so default actions
// (closing a modal dialog on Escape) happen as in the app.
import assert from 'node:assert/strict';

const MOD = process.platform === 'darwin' ? 'meta' : 'control';

export async function runFindChecks(p, url = 'http://127.0.0.1:5188/tests/find-fixture.html') {
  await p.goto(url);
  await p.waitForSelector('#diff-panel .diff-unified-view');
  await p.waitForSelector('#files-panel .files-code__content .token');
  const results = {};
  const focus = (selector) =>
    p.evaluate((selector) => document.querySelector(selector).focus(), selector);
  const status = () => p.evaluate(() => document.querySelector('.find-widget__count')?.textContent);
  const waitStatus = (text) =>
    p
      .waitForFunction(
        (text) => document.querySelector('.find-widget__count')?.textContent === text,
        text,
      )
      .catch(async (error) => {
        throw new Error(`Expected "${text}", got "${await status()}"`, { cause: error });
      });
  const search = async (query, expected) => {
    await p.fill('.find-widget__input', query);
    await waitStatus(expected);
  };
  const painted = () =>
    p.evaluate(() => ({
      matches: [...(CSS.highlights.get('alune-find-match') ?? [])].map(String),
      current: [...(CSS.highlights.get('alune-find-current') ?? [])].map(String),
    }));
  const currentVisible = (container) =>
    p.evaluate((container) => {
      const [range] = CSS.highlights.get('alune-find-current');
      const box = range.getBoundingClientRect();
      const view = document.querySelector(container).getBoundingClientRect();
      return (
        box.top >= view.top &&
        box.bottom <= view.bottom &&
        box.left >= view.left &&
        box.right <= view.right
      );
    }, container);
  const open = async (selector) => {
    await focus(selector);
    await p.key('F', [MOD]);
    await p.waitForFunction(() => document.activeElement?.classList.contains('find-widget__input'));
  };

  // Unified Diff: tokens, prefixes, hunk headers and line numbers.
  await open('#diff-panel .diff-shell__body');
  await search('foo.bar(', '第 1 项，共 2 项');
  assert.deepEqual((await painted()).matches, ['foo.bar(', 'foo.bar(']);
  await search('needle', '第 1 项，共 3 项');
  await p.evaluate(() => {
    document.querySelector('.find-widget__option[aria-label="全字匹配"]').click();
  });
  await search('1', '第 1 项，共 2 项');
  results.unified = await status();

  // Options combine, and an invalid regex keeps the previous results.
  await p.evaluate(() => {
    document.querySelector('.find-widget__option[aria-label="使用正则表达式"]').click();
  });
  await search('use\\w+', '第 1 项，共 4 项');
  await p.fill('.find-widget__input', '(');
  await p.waitForSelector('.find-widget__error');
  assert.equal(await status(), '第 1 项，共 4 项');
  assert.equal((await painted()).matches.length, 4);
  await p.key('R', process.platform === 'darwin' ? ['alt', 'meta'] : ['alt']);
  await p.waitForFunction(
    () =>
      document.querySelector('.find-widget__option[aria-label="使用正则表达式"]').ariaPressed ===
      'false',
  );
  await p.evaluate(() => {
    document.querySelector('.find-widget__option[aria-label="全字匹配"]').click();
    document.querySelector('.find-widget__option[aria-label="大小写匹配"]').click();
  });
  await search('Needle', '无结果');
  assert.ok(await p.evaluate(() => !!document.querySelector('.find-widget__field--error')));
  await p.evaluate(() => {
    document.querySelector('.find-widget__option[aria-label="大小写匹配"]').click();
  });

  // Navigation wraps and reveals the far, horizontally overflowing match.
  await search('needle', '第 1 项，共 3 项');
  await p.key('Enter');
  await waitStatus('第 2 项，共 3 项');
  await p.key('Enter');
  await waitStatus('第 3 项，共 3 项');
  assert.ok(await currentVisible('#diff-panel .diff-shell__body'));
  await p.key('Enter');
  await waitStatus('第 1 项，共 3 项');
  await p.key('Enter', ['shift']);
  await waitStatus('第 3 项，共 3 项');
  await p.key('F3');
  await waitStatus('第 1 项，共 3 项');

  // Split view searches both sides, and refreshed content is searched again.
  await p.evaluate(() => {
    [...document.querySelectorAll('#diff-panel .ant-segmented-item')].at(-1).click();
  });
  await waitStatus('第 1 项，共 4 项');
  assert.deepEqual(
    await p.evaluate(() =>
      [...CSS.highlights.get('alune-find-match')].map(
        (range) =>
          range.startContainer.parentElement
            .closest('.diff-split-cell')
            .className.match(/--(\w+)/)[1],
      ),
    ),
    ['remove', 'add', 'context', 'context'],
  );
  await p.evaluate(() => document.querySelector('#refresh-diff').click());
  await waitStatus('第 1 项，共 5 项');
  results.split = await status();

  // Escape closes and clears highlights, returning focus to the content.
  await focus('.find-widget__input');
  await p.key('Escape');
  await p.waitForFunction(() => !document.querySelector('.find-widget'));
  assert.equal(await p.evaluate(() => CSS.highlights.has('alune-find-match')), false);
  assert.ok(await p.evaluate(() => document.activeElement.classList.contains('diff-shell__body')));

  // The selected text (single line) seeds the search.
  await p.evaluate(() => {
    const code = document.querySelector('#diff-panel .diff-split-cell--add code');
    const text = [...code.querySelectorAll('*')]
      .flatMap((node) => [...node.childNodes])
      .find((node) => node.nodeType === 3 && node.data.includes('needle'));
    const start = text.data.indexOf('needle');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 6);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await p.key('F', [MOD]);
  await waitStatus('第 1 项，共 5 项');
  assert.equal(
    await p.evaluate(() => document.querySelector('.find-widget__input').value),
    'needle',
  );
  await p.key('Escape');

  // Fullscreen Diff: the first Escape closes the widget, the second leaves fullscreen.
  await p.evaluate(() => document.querySelector('[aria-label="全屏查看差异"]').click());
  await p.waitForSelector('dialog.diff-shell--fullscreen:modal');
  await open('.diff-shell--fullscreen .diff-shell__body');
  await search('needle', '第 1 项，共 5 项');
  await p.key('Escape');
  await p.waitForFunction(() => !document.querySelector('.find-widget'));
  assert.ok(
    await p.evaluate(() => !!document.querySelector('dialog.diff-shell--fullscreen:modal')),
  );
  await p.key('Escape');
  await p.waitForFunction(() => !document.querySelector('.diff-shell--fullscreen'));
  results.fullscreen = 'ok';

  // Other inputs (a field, the terminal's textarea) keep their own Cmd/Ctrl+F.
  for (const selector of ['#other-input', '#terminal-input']) {
    await p.evaluate(() => {
      window.__findPrevented = undefined;
      window.addEventListener(
        'keydown',
        (event) => (window.__findPrevented = event.defaultPrevented),
        {
          once: true,
        },
      );
    });
    await focus(selector);
    await p.key('F', [MOD]);
    assert.equal(await p.evaluate(() => document.querySelectorAll('.find-widget').length), 0);
    assert.equal(await p.evaluate(() => window.__findPrevented), false);
  }

  // Large files stay responsive and cap the count like VSCode.
  await open('#files-panel .files-code');
  const started = await p.evaluate(() => performance.now());
  await search('needle', '第 1 项，共 12 项');
  results.largeFileMs = Math.round((await p.evaluate(() => performance.now())) - started);
  assert.ok(results.largeFileMs < 1500, `large file search took ${results.largeFileMs}ms`);
  await p.evaluate(() => {
    document
      .querySelector('#files-panel .find-widget__option[aria-label="使用正则表达式"]')
      .click();
  });
  // A new search continues from the current match, like VSCode.
  await search('\\d', '第 2 项，共 19999+ 项');
  await p.evaluate(() => {
    document
      .querySelector('#files-panel .find-widget__option[aria-label="使用正则表达式"]')
      .click();
  });
  await search('needle', '第 2 项，共 12 项');
  await p.key('Enter', ['shift']);
  await waitStatus('第 1 项，共 12 项');
  await p.key('Enter', ['shift']);
  await waitStatus('第 12 项，共 12 项');
  assert.ok(await currentVisible('#files-panel .files-code'));
  await p.evaluate(() => document.querySelector('#switch-file').click());
  await waitStatus('第 1 项，共 1 项');
  await focus('#files-panel .find-widget__input');
  await p.key('Escape');

  // Blame annotations are not searched.
  await open('#blame-panel .files-code');
  await search('needle', '第 1 项，共 3 项');
  results.blame = await status();
  await p.key('Escape');
  return results;
}
