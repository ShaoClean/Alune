const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { execFileSync } = require('node:child_process');
module.exports = async ({
  window,
  origin,
  wait,
  pass: record,
  element: sel,
  button: aria,
  textButton,
  click,
}) => {
  const repo = process.env.ALUNE_TEST_REVIEW_REPO,
    url = process.env.ALUNE_TEST_REVIEW_URL,
    w = window.webContents;
  assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.equal(
    execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }).trim(),
    url,
  );
  const ev = (x) => w.executeJavaScript(x);
  const btn = (label, scope = 'button') =>
    scope === 'button'
      ? textButton(label)
      : `[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.getClientRects().length&&!e.closest('[inert]')&&e.textContent.replace(/\\s/g,'')===${JSON.stringify(label.replace(/\s/g, ''))})`;
  const fill = (x, value) =>
    wait(
      w,
      `(()=>{const e=(${x});if(!e||e.disabled||e.readOnly)return false;e.focus();Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
  const select = async (label, name) => {
    await wait(
      w,
      `(()=>{const e=(${aria(label)})?.closest('.ant-select');if(!e)return false;e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`,
    );
    await click(btn(name, '.ant-select-item-option'));
  };
  await window.loadURL(origin + '/repositories');
  await click(aria('打开本地仓库'));
  await fill(sel('#local-repo-path'), repo);
  await click(btn('检查仓库'));
  await click(btn('打开工作区', '.a-dlg-actions button'));
  await click(aria('PR/MR'));
  await wait(w, sel('.pull-requests-access-toggle'));
  if (
    !(await ev(
      "document.querySelector('.pull-requests-access-toggle').getAttribute('aria-expanded')==='true'",
    ))
  )
    await click(sel('.pull-requests-access-toggle'));
  await select('托管平台', 'GitLab（自建）');
  await click(btn('应用到此仓库'));
  await wait(w, btn('已记住选择'));

  await click(sel('.pull-requests-auth summary'));
  await fill(aria('访问令牌'), 'local-test-token');
  await click(btn('应用令牌'));
  await wait(
    w,
    "document.querySelector('.pull-requests-auth summary')?.textContent.includes('已应用')",
  );
  const row = "document.querySelector('.pull-request-row__open')";
  // Session-token application posts a read-only status notification. Dismiss
  // it before interacting with controls beneath the modal.
  const notice = await ev("document.querySelector('.feedback-dialog[open]')?.innerText");
  if (notice) {
    assert.match(notice, /正在使用仅本次输入的令牌/);
    await click(sel('.feedback-dialog[open] [aria-label="关闭提示"]'));
  }
  await wait(w, row);
  const title = await ev('(' + row + ').textContent');
  await click(row);
  await wait(
    w,
    "document.querySelector('.pull-request-detail__heading h2')?.textContent===" +
      JSON.stringify(title),
  );
  await wait(w, sel('.pull-request-files__list button[title]'));
  const file = await ev("document.querySelector('.pull-request-files__list button[title]').title");
  await wait(
    w,
    "document.querySelector('.pull-request-files__diff')?.getAttribute('aria-label')===" +
      JSON.stringify('Diff ' + file),
  );
  await record(
    ['UI-032', 'UI-031'],
    'select the self-hosted GitLab platform, apply a one-session token, open the selected MR and load its real file Diff',
  );
  // File navigation and range selections must keep the reviewed path and side.
  const pickFile = (name) => sel('.pull-request-files__list button[title="' + name + '"]');
  await click(pickFile('renamed.txt'));
  await wait(w, aria('Diff renamed.txt'));
  await click(pickFile('file.txt'));
  await wait(w, aria('Diff file.txt'));
  await click(btn('详情侧栏'));
  await wait(w, aria('请求详情'));
  await click(btn('收起详情'));
  await click(btn('合并', '.pull-request-actions__buttons button'));
  await wait(w, sel('.a-dlg-actions button'));
  await click(btn('取消', '.a-dlg-actions button'));
  await click(aria('更多审阅操作'));
  await click(btn('关闭 PR/MR', '[role=menuitem]'));
  await wait(w, "document.querySelector('.a-dlg-shell')?.textContent.includes('确认关闭 PR/MR')");
  await click(btn('取消', '.a-dlg-actions button'));
  await wait(
    w,
    "document.querySelector('.pull-request-detail__heading h2')?.textContent===" +
      JSON.stringify(title),
  );
  await record(
    ['UI-030', 'UI-031'],
    'select a renamed file and return, inspect and collapse request details, cancel both merge and close without changing platform state',
  );
  const line = (n) => sel('button[aria-label^="新行 ' + n + '，点击评论"]');
  await click(line(2));
  await wait(
    w,
    `(()=>{const e=(${line(3)});if(!e||e.disabled)return false;e.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));return true})()`,
  );
  await wait(w, "document.querySelector('.pull-request-composer')?.innerText.includes('2–3')");
  await fill(aria('代码评论内容'), 'Local range comment');
  await click(btn('发表评论', '.pull-request-composer button'));
  await wait(
    w,
    "[...document.querySelectorAll('.pull-request-thread')].some(e=>e.textContent.includes('Local range comment'))",
  );
  await record(
    ['UI-030', 'UI-031'],
    'post one code discussion on adjacent added lines and see the resulting thread on the selected file',
  );
  await click(btn('评论与讨论', '[aria-label="审阅内容"] [role="tab"]'));
  const comment = 'A local-only UI acceptance comment';
  await fill(aria('普通评论内容'), comment);
  await click(btn('发表评论'));
  await wait(
    w,
    "[...document.querySelectorAll('.pull-request-thread')].some(e=>e.textContent.includes(" +
      JSON.stringify(comment) +
      '))',
  );
  await record(
    ['UI-030', 'UI-031'],
    'post a comment through the discussion composer and see the same text in the resulting thread',
  );
  await click(aria('返回列表'));
  await click(btn('创建 PR/MR'));
  await wait(w, aria('PR/MR 标题'));
  const newTitle = 'Controlled draft from UI';
  await fill(aria('PR/MR 标题'), newTitle);
  await fill(aria('PR/MR 描述'), 'Only sent to the disposable HTTPS peer.');
  fs.writeFileSync(process.env.ALUNE_TEST_REVIEW_MARKER, 'true');
  const draft =
    "[...document.querySelectorAll('.a-dlg-shell label')].find(e=>e.textContent.includes('创建为草稿'))?.querySelector('input')";
  await wait(w, draft);
  if (!(await ev('(' + draft + ').checked'))) await click(draft);
  await click(btn('创建草稿', '.a-dlg-actions button'));
  await wait(
    w,
    "document.querySelector('.pull-request-detail__heading h2')?.textContent.includes(" +
      JSON.stringify(newTitle) +
      ')',
  );
  await record(
    ['UI-012', 'UI-031', 'UI-032'],
    'create a draft MR for the previewed source branch and open the returned request',
  );
  await window.loadURL(origin + '/pull-requests');
  const centerList = '.pr-center-list .pull-request-row__open',
    centerRow = `[...document.querySelectorAll('${centerList}')].find(e=>e.textContent.includes(${JSON.stringify(newTitle)}))`;
  await wait(w, centerRow);
  await click(sel('.pr-center-actions button:first-child'));
  await wait(
    w,
    "document.querySelector('.pr-center-drawer')?.innerText.includes('team/review') || [...document.querySelectorAll('[role=dialog]')].some(e=>e.getClientRects().length&&e.textContent.includes('team/review'))",
  );
  await click(aria('关闭数据来源'));
  async function showFilters() {
    if (!(await ev('Boolean(' + aria('搜索 PR/MR') + ')')))
      await click(btn('筛选', '.pr-center-toolbar button'));
  }
  async function hideFilters() {
    const close = aria('关闭筛选');
    if (await ev('Boolean(' + close + ')')) await click(close);
  }
  await showFilters();
  await select('筛选平台', 'GitHub');
  await wait(
    w,
    "!document.querySelector('.pr-center-list .pull-request-row__open') && !document.querySelector('.pr-center-actions .ant-btn-loading')",
  );
  await select('筛选平台', 'GitLab');
  await wait(w, centerRow);
  await fill(aria('搜索 PR/MR'), 'unmatched UI receipt');
  await wait(w, "!document.querySelector('.pr-center-list .pull-request-row__open')");
  await fill(aria('搜索 PR/MR'), newTitle);
  await hideFilters();
  await wait(w, centerRow);
  await click(centerRow);
  await wait(
    w,
    "document.querySelector('.pr-center-detail h2')?.textContent.includes(" +
      JSON.stringify(newTitle) +
      ')',
  );
  await click(btn('← PR/MR 中心'));
  await wait(w, centerRow);
  await record(
    ['UI-069', 'UI-032', 'UI-031'],
    'cross-repository center discovers saved source, composes platform and search filters, opens the exact new MR and returns to its filtered list',
  );
  // Check the real breakpoint rather than treating a hidden duplicate filter as active.
  const zoom = w.getZoomFactor(),
    width = await ev('innerWidth');
  try {
    w.setZoomFactor(zoom * Math.max(1, width / 740));
    await wait(w, "matchMedia('(max-width: 900px)').matches");
    await showFilters();
    await select('筛选状态', '已关闭');
    await click(btn('清除筛选', '.pr-center-drawer button'));
    await hideFilters();
    await wait(w, centerRow);
    await showFilters();
    await select('筛选状态', '已关闭');
    await hideFilters();
    const closedRow = `[...document.querySelectorAll('${centerList}')].find(e=>e.textContent==='Archived fixture request')`;
    await wait(w, closedRow);
    assert.equal(await ev('Boolean(' + centerRow + ')'), false);
    await click(closedRow);
    await wait(
      w,
      "document.querySelector('.pr-center-detail h2')?.textContent==='Archived fixture request'",
    );
    await click(btn('← PR/MR 中心'));
    await wait(w, closedRow);
    await showFilters();
    await select('筛选状态', '全部状态');
    await hideFilters();
    await wait(w, centerRow);
    await showFilters();
    await ev(
      "document.querySelector('.pr-center-drawer[open]').dispatchEvent(new Event('cancel',{cancelable:true}))",
    );
    await wait(w, "!document.querySelector('.pr-center-drawer[open]')");
    await record(
      ['UI-069', 'UI-032'],
      'narrow center drawer edits and clears filters, isolates the closed MR, restores filter after detail navigation and dismisses with cancel',
    );
  } finally {
    w.setZoomFactor(zoom);
  }
  await window.loadURL(origin + '/repositories');
  await click(aria('删除 review-project'));
  await click(btn('移除登记'));
  await wait(w, '!(' + aria('删除 review-project') + ')');
  assert.ok(fs.existsSync(repo));
};
