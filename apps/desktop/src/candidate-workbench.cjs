// Native release-candidate renderer: use the same controls as the workspace
// and cross-check the selected data against the on-disk Git fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, id, repo, wait }) => {
  const wc = window.webContents,
    evaluate = (code) => wc.executeJavaScript(code);
  const { visible, element, button, textButton, click, text } =
    require('./candidate-ui-driver.cjs')(wc, wait);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const evidence = [];
  const { counts } = require('./candidate-ui-audit.cjs');
  let before = await counts(wc);
  async function pass(ui, scenario, facts) {
    const current = await counts(wc);
    const executed = [...current].filter(([id, n]) => n > (before.get(id) ?? 0)).map(([id]) => id);
    before = current;
    console.log('Verified workbench scenario:', scenario);
    evidence.push({
      ui,
      scenario,
      ...(facts === undefined ? {} : { facts }),
      executed,
      sha: process.env.GITHUB_SHA ?? null,
      proof: process.env.GITHUB_RUN_ID
        ? 'https://github.com/' +
          process.env.GITHUB_REPOSITORY +
          '/actions/runs/' +
          process.env.GITHUB_RUN_ID
        : null,
      platform: process.platform,
      arch: process.arch,
    });
    if (process.env.ALUNE_CANDIDATE_EVIDENCE)
      fs.writeFileSync(
        path.join(process.env.ALUNE_CANDIDATE_EVIDENCE, 'workbench.json'),
        JSON.stringify(evidence, null, 2),
      );
  }
  await window.loadURL(origin + '/repositories');
  await click(button('列表视图'));
  await wait(wc, element('table[aria-label="仓库列表"]'));
  await click(button('数据总览视图'));
  await click(button('采集统计'));
  await wait(wc, text('统计覆盖 1/1'));
  await click(button('卡片视图'));
  await wait(wc, element('.repository-card'));
  await pass(
    ['UI-009', 'UI-039', 'UI-070'],
    'collection list/overview/collect/grid, one real repository',
  );
  await require('./candidate-overview-actions.cjs')({ window, origin, repo, wait, pass });
  await window.loadURL(origin + '/repositories/' + id);
  await click(button('文件'));
  const treeItem = (name) =>
    "[...document.querySelectorAll('.files-tree__item')].filter(" +
    visible +
    ').find(e=>e.textContent.includes(' +
    JSON.stringify(name) +
    '))';
  await click(treeItem('README.md'));
  await click(textButton('Preview'));
  await wait(wc, element('a[href="example.ts"]') + ' || ' + element('.markdown-preview a'));
  const link =
    "[...document.querySelectorAll('a')].filter(" +
    visible +
    ").find(e=>e.textContent==='fixture source')";
  await click(link);
  await wait(wc, "document.querySelector('.files-code')?.textContent.includes('answer')");
  await click(textButton('逐行追溯'));
  await wait(wc, element('.blame-gutter'));
  await click(textButton('逐行追溯'));
  await wait(wc, element('.files-code'));
  await pass(
    ['UI-004', 'UI-008', 'UI-017', 'UI-027'],
    'Markdown relative link opens tracked source; Blame round-trip',
  );
  await click(button('提交历史'));
  await wait(wc, element('.history-row__message'));
  assert.ok(
    (await evaluate("document.querySelector('.history-row__message').textContent")).includes(
      'candidate fixture',
    ),
  );
  await click(element('.history-row__message'));
  await wait(wc, text('example.ts'));
  await pass(
    ['UI-021', 'UI-022'],
    'history row matches HEAD; selected commit exposes real changed files',
  );
  await click(button('分支'));
  await wait(wc, element('.branch-list'));
  await wait(wc, text('ui-baseline'));
  await click(textButton('新建分支'));
  const input = element('input[placeholder="feature/my-change"]');
  await wait(wc, input);
  await evaluate(
    '(()=>{const e=' +
      input +
      ";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'p8-native-branch');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await click(element('.a-dlg-actions .ant-btn-primary'));
  await wait(
    wc,
    "document.querySelector('.branch-pill__name')?.textContent.includes('p8-native-branch')",
  );
  assert.equal(git('branch', '--show-current'), 'p8-native-branch');
  assert.equal(git('rev-parse', 'ui-baseline'), git('rev-parse', 'HEAD'));
  await click(button('切换到 main'));
  await wait(wc, "document.querySelector('.branch-pill__name')?.textContent.trim()==='main'");
  assert.equal(git('branch', '--show-current'), 'main');
  await pass(
    ['UI-006', 'UI-045', 'UI-072'],
    'create and switch branch with staged edits; registered tag retains the original commit',
  );
  await click(element('button[aria-label^="改动"]'));
  await click(button('查看差异 candidate.txt（已暂存）'));
  await wait(wc, element('.diff-code-row--add'));
  await click(button('在整个文件中查看差异'));
  await wait(wc, element('[aria-label="在整个文件中查看差异"][aria-pressed="true"]'));
  await click(button('关闭差异'));
  await wait(wc, text('选择文件以查看差异'));
  await pass(
    ['UI-007', 'UI-015'],
    'selected staged file opens real diff, toggles full-file view and closes',
  );
  await require('./candidate-git-actions.cjs')({
    wc,
    window,
    origin,
    repo,
    id,
    wait,
    element,
    button,
    textButton,
    click,
    text,
    pass,
  });
  await require('./candidate-settings-actions.cjs')({
    wc,
    window,
    origin,
    id,
    repo,
    wait,
    element,
    button,
    textButton,
    click,
    pass,
  });
  if (process.env.ALUNE_TEST_REVIEW_REPO) {
    await require('./candidate-review-actions.cjs')({
      window,
      origin,
      wait,
      pass,
      element,
      button,
      textButton,
      click,
    });
    await window.loadURL(origin + '/repositories/' + id);
    await wait(wc, button('取消暂存 candidate.txt'));
  }
  if (process.env.ALUNE_TEST_DIRECTORY_ACCESS) {
    await require('./candidate-directory-access.cjs')({ window, origin, wait, pass });
    await window.loadURL(origin + '/repositories/' + id);
    await wait(wc, button('取消暂存 candidate.txt'));
  }
  await require('./candidate-branch-overview.cjs')({ window, origin, id, repo, wait, pass });
  console.log('Candidate native workbench: ' + evidence.length + ' scenarios passed');
};
