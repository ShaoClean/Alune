// Only invoked in the isolated restore phase of the synthetic desktop fixture.
const assert = require('node:assert/strict');
module.exports = async ({ window, origin, id, wait, measure }) => {
  const wc = window.webContents,
    ev = (x) => wc.executeJavaScript(x);
  const { element, button, textButton, click, input, select, text } =
    require('./candidate-ui-driver.cjs')(wc, wait);
  const tokenName = 'Fixture review credential',
    renamed = 'Renamed review credential',
    first = 'smoke-named-initial',
    second = 'smoke-named-replacement';
  const tokens = () => window.loadURL(origin + '/settings/tokens'),
    footer = (label) => textButton(label, '.a-dlg-actions button');
  const masked = async () => {
    const field = element('.a-dlg-shell input[aria-label="已保存的令牌值"]');
    await wait(wc, '(' + field + ')?.disabled===true');
    assert.match(await ev('(' + field + ').value'), /^•+$/);
    for (const value of [first, second]) assert.equal(await ev(text(value)), false);
  };
  const count = (kind) =>
    require('node:fs')
      .readFileSync(process.env.ALUNE_TEST_TOKEN_PROOF, 'utf8')
      .split('\n')
      .filter((v) => v === kind).length;
  async function observeAfterReload(kind) {
    const before = count(kind);
    await window.loadURL(reviewUrl);
    await wait(wc, element('.pull-request-row__open'));
    const end = Date.now() + 8000;
    while (count(kind) === before) {
      if (Date.now() > end) {
        const state = await ev(
          "JSON.stringify({access:document.querySelector('.pull-requests-auth summary')?.textContent,notice:document.querySelector('.feedback-dialog[open]')?.innerText,errors:[...document.querySelectorAll('[role=alert]')].filter(e=>e.getClientRects().length).map(e=>e.textContent)})",
        );
        throw Error(
          'No fresh ' +
            kind +
            ' credential reached the test peer: ' +
            JSON.stringify({
              before,
              initial: count('initial'),
              replaced: count('replaced'),
              state,
            }),
        );
      }
      await new Promise((ok) => setTimeout(ok, 40));
    }
  }
  let reviewUrl;
  await measure(
      ['UI-054'],
    'create a synthetic named token, toggle input visibility, filter results, reopen and verify only the mask is shown',
    async () => {
      await tokens();
      await click(textButton('添加第一个令牌'));
      await input(button('令牌名称'), tokenName);
      await input(button('令牌值'), first);
      await click(button('显示令牌值'));
      assert.equal(await ev('(' + button('令牌值') + ').type'), 'text');
      await click(button('隐藏令牌值'));
      assert.equal(await ev('(' + button('令牌值') + ').type'), 'password');
      await click(footer('保存令牌'));
      await wait(wc, button('编辑令牌 ' + tokenName));
      await tokens();
      await wait(wc, button('搜索令牌'));
      await input(button('搜索令牌'), 'not a fixture token');
      await wait(wc, text('没有匹配的令牌'));
      await input(button('搜索令牌'), tokenName);
      await click(button('编辑令牌 ' + tokenName));
      await masked();
      await click(footer('取消'));
      await wait(wc, '!(' + footer('保存令牌') + ')');
    },
  );
  await measure(
      ['UI-032', 'UI-040', 'UI-070'],
    'remember the named credential for this exact HTTPS remote and restore the request list without a session token',
    async () => {
      await window.loadURL(origin + '/repositories');
      await click(button('打开本地仓库'));
      await input(element('#local-repo-path'), process.env.ALUNE_TEST_REVIEW_REPO);
      await click(textButton('检查仓库'));
      await click(footer('打开工作区'));
      await click(button('PR/MR'));
      const current = new URL(wc.getURL());
      current.searchParams.set('panel', 'pull-requests');
      reviewUrl = current.href;
      const toggle = element('.pull-requests-access-toggle');
      await wait(wc, toggle);
      if (!(await ev('(' + toggle + ').getAttribute("aria-expanded")==="true"')))
        await click(toggle);
      await select('托管平台', 'GitLab（自建）');
      await select('选择命名令牌', tokenName);
      await click(textButton('应用到此仓库'));
      await wait(wc, textButton('已记住选择'));
      await window.loadURL(reviewUrl);
      await wait(wc, element('.pull-request-row__open'));
    },
  );
  await measure(
      ['UI-054', 'UI-032'],
    'inspect the association, rename without exposing or replacing the secret, then explicitly rotate its value and reopen the same repository',
    async () => {
      await tokens();
      await click(textButton('1 个仓库关联'));
      await wait(wc, '(' + element('.a-dlg-shell') + ")?.innerText.includes('team/review')");
      await click(textButton('关闭', '.a-dlg-shell button'));
      await click(button('编辑令牌 ' + tokenName));
      await masked();
      await input(button('令牌名称'), renamed);
      await click(footer('保存令牌'));
      await wait(wc, button('编辑令牌 ' + renamed));
      await observeAfterReload('initial');
      await tokens();
      await click(button('编辑令牌 ' + renamed));
      await masked();
      await click(textButton('更换令牌值'));
      await input(button('令牌值'), second);
      await click(footer('保存令牌'));
      // A failed save can replace the footer with a feedback view. Require
      // the editor itself to close, not merely the absence of its Save button.
      await wait(
        wc,
        `(()=>{const n=(${element('.a-dlg-shell .feedback-description')});if(n?.textContent.trim())throw Error('Token replacement failed: '+n.textContent);return !(${element('.a-dlg-shell input[aria-label="令牌值"]')})})()`,
      );
      await observeAfterReload('replaced');
    },
  );
  await measure(
      ['UI-054', 'UI-032'],
    'cancel deletion with an association, then confirm it and verify the remembered repository selection is no longer valid',
    async () => {
      await tokens();
      await click(button('删除令牌 ' + renamed));
      await wait(wc, text('team/review'));
      await click(footer('取消'));
      await wait(wc, '!(' + footer('删除令牌及关联') + ')');
      await click(button('删除令牌 ' + renamed));
      await click(footer('删除令牌及关联'));
      await wait(wc, text('还没有保存令牌'));
      await window.loadURL(reviewUrl);
      await wait(
        wc,
        "document.body.innerText.includes('需要重新关联')||document.body.innerText.includes('访问令牌关联已失效')",
      );
    },
  );
  await window.loadURL(origin + '/repositories');
  await click(button('删除 review-project'));
  await click(textButton('移除登记'));
  await wait(wc, '!(' + button('删除 review-project') + ')');
  await window.loadURL(origin + '/repositories/' + id);
  await wait(wc, button('取消暂存 candidate.txt'));
};
