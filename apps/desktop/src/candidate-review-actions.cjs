const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { execFileSync } = require('node:child_process');
module.exports = async ({
  window,
  origin,
  wait: rawWait,
  pass: record,
  element: sel,
  button: aria,
  textButton,
  click,
}) => {
  const repo = process.env.ALUNE_TEST_REVIEW_REPO,
    url = process.env.ALUNE_TEST_REVIEW_URL,
    w = window.webContents;
  const wait = async (contents, condition) => {
    try {
      return await rawWait(contents, condition);
    } catch (error) {
      console.error(
        'PR center condition',
        condition,
        await w.executeJavaScript(
          'JSON.stringify({url:location.href,searches:[...document.querySelectorAll("input")].filter(e=>e.getAttribute("aria-label")==="搜索 PR/MR").map(e=>e.value)})',
        ),
      );
      throw error;
    }
  };
  assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.equal(
    execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }).trim(),
    url,
  );
  const ev = async (x) => {
    try {
      return await w.executeJavaScript(x);
    } catch (cause) {
      throw new Error('Review renderer query failed: ' + x, { cause });
    }
  };
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
    await wait(w, '(' + aria(label) + ')?.getAttribute("aria-expanded")==="true"');
    const popup =
      'document.getElementById((' +
      aria(label) +
      ').getAttribute("aria-controls"))?.closest(".ant-select-dropdown")';
    await click(
      '(()=>{const root=(' +
        popup +
        ');return root&&[...root.querySelectorAll(".ant-select-item-option")].find(e=>e.getClientRects().length&&e.textContent.trim()===' +
        JSON.stringify(name) +
        ')})()',
    );
    if (
      await ev(
        '(' + aria(label) + ').closest(".ant-select").classList.contains("ant-select-multiple")',
      )
    ) {
      await wait(
        w,
        '[...(' +
          aria(label) +
          ').closest(".ant-select").querySelectorAll(".ant-select-selection-item")].some(e=>e.title===' +
          JSON.stringify(name) +
          ')',
      );
      await ev(
        '(()=>{const e=(' +
          aria(label) +
          ');e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",keyCode:27,which:27,bubbles:true,cancelable:true}))})()',
      );
      await wait(w, '(' + aria(label) + ')?.getAttribute("aria-expanded")!=="true"');
    }
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
  await click(btn('全部状态', '.pull-requests-filters label'));
  await wait(
    w,
    "[...document.querySelectorAll('.pull-request-row__open')].some(e=>e.textContent.includes('Archived fixture request'))",
  );
  await click(btn('开放中', '.pull-requests-filters label'));
  await wait(
    w,
    "![...document.querySelectorAll('.pull-request-row__open')].some(e=>e.textContent.includes('Archived fixture request'))",
  );
  await wait(w, row);
  await record(
    ['UI-032'],
    'repository MR state filter includes the controlled closed request under all states and removes it when returning to open requests',
  );
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
  const tabs = sel('[aria-label="审阅内容"]');
  const tabKey = async (key) =>
    wait(
      w,
      `(()=>{const e=(${tabs});if(!e)return false;e.querySelector('[aria-selected=true]').focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}));return true})()`,
    );
  await tabKey('End');
  await wait(w, `(${tabs})?.querySelector('[aria-selected=true]')?.textContent==='概览'`);
  await tabKey('ArrowLeft');
  await wait(w, `(${tabs})?.querySelector('[aria-selected=true]')?.textContent==='评论与讨论'`);
  await tabKey('Home');
  await wait(
    w,
    `(${tabs})?.querySelector('[aria-selected=true]')?.textContent.includes('文件变动')`,
  );
  await record(
    ['UI-030', 'UI-031'],
    'review tab keyboard events select overview, discussions and files in order while retaining the same request title and file',
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
  await click(btn('压缩并合并提交', '.a-dlg-shell label'));
  await wait(
    w,
    "document.querySelector('.a-dlg-shell .ant-segmented-item-selected')?.textContent==='压缩并合并提交'",
  );
  await click(btn('取消', '.a-dlg-actions button'));
  await click(aria('更多审阅操作'));
  await click(btn('关闭 PR/MR', '[role=menuitem]'));
  await wait(w, "document.querySelector('.a-dlg-shell')?.textContent.includes('确认关闭 PR/MR')");
  const closeAck = sel('.a-dlg-shell .dlg-check input');
  await wait(w, closeAck);
  const closeSubmit = btn('确认关闭', '.a-dlg-actions button');
  await wait(w, '(' + closeSubmit + ')');
  assert.equal(await ev('(' + closeSubmit + ').disabled'), true);
  await click(closeAck);
  await wait(w, '(' + closeSubmit + ').disabled===false');
  await click(closeAck);
  await wait(w, '(' + closeSubmit + ').disabled===true');
  await click(btn('取消', '.a-dlg-actions button'));
  await wait(
    w,
    "document.querySelector('.pull-request-detail__heading h2')?.textContent===" +
      JSON.stringify(title),
  );
  await record(
    ['UI-030', 'UI-031'],
    'select a renamed file, inspect details, choose squash then cancel merge, toggle close acknowledgement on and off then cancel without any platform write',
  );
  const line = (n) => sel('button[aria-label^="新行 ' + n + '，点击评论"]');
  await click(line(2));
  await fill(aria('代码评论内容'), 'unposted inline draft');
  await click(btn('取消选区，保留正文'));
  await click(btn('评论与讨论', '[aria-label="审阅内容"] [role=tab]'));
  await wait(w, '(' + aria('普通评论内容') + ')?.value==="unposted inline draft"');
  await fill(aria('普通评论内容'), '');
  assert.equal(await ev('(' + btn('发表评论') + ').disabled'), true);
  await click(btn('文件变动 (2)', '[aria-label="审阅内容"] [role=tab]'));
  await wait(w, aria('Diff file.txt'));
  await click(line(2));
  await fill(aria('代码评论内容'), 'switch to ordinary draft');
  await click(btn('评论与讨论', '[aria-label="审阅内容"] [role=tab]'));
  await click(btn('改为 普通评论'));
  await wait(w, '(' + aria('普通评论内容') + ')?.value==="switch to ordinary draft"');
  await fill(aria('普通评论内容'), '');
  await click(btn('文件变动 (2)', '[aria-label="审阅内容"] [role=tab]'));
  await wait(w, aria('Diff file.txt'));
  await record(
    ['UI-030', 'UI-031'],
    'cancel an inline range and convert another code draft to an ordinary comment while preserving each body; clearing either draft disables posting and issues no write',
  );
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
    ['UI-030', 'UI-031', 'UI-032'],
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
    ['UI-030', 'UI-031', 'UI-032'],
    'post a comment through the discussion composer and see the same text in the resulting thread',
  );
  await click(aria('返回列表'));
  await click(btn('创建 PR/MR'));
  await wait(w, aria('PR/MR 标题'));
  await fill(aria('PR/MR 标题'), 'cancelled pending preview');
  await click(btn('取消', '.a-dlg-actions button'));
  await wait(w, '!(' + aria('PR/MR 标题') + ')');
  await record(
    ['UI-012', 'UI-031', 'UI-032'],
    'cancel creation while the controlled branch comparison is pending; the dialog closes without creating a request',
  );
  await click(btn('创建 PR/MR'));
  await wait(w, aria('PR/MR 标题'));
  const newTitle = 'Controlled draft from UI';
  await fill(aria('PR/MR 标题'), newTitle);
  await fill(aria('PR/MR 描述'), 'Only sent to the disposable HTTPS peer.');
  fs.writeFileSync(process.env.ALUNE_TEST_REVIEW_MARKER, 'true');
  await wait(
    w,
    "document.querySelector('.pr-create__preview')?.textContent.includes('automatic suggestion')",
  );
  assert.equal(await ev('(' + aria('PR/MR 标题') + ').value'), newTitle);
  assert.equal(
    await ev('(' + aria('PR/MR 描述') + ').value'),
    'Only sent to the disposable HTTPS peer.',
  );
  await fill(aria('目标分支'), 'feature/review');
  await click(btn('预览改动', '.pr-create button'));
  await wait(
    w,
    "document.querySelector('.pr-create__notice')?.textContent.includes('源分支与目标分支相同')",
  );
  assert.equal(await ev('(' + btn('创建 PR/MR', '.a-dlg-actions button') + ').disabled'), true);
  await fill(aria('目标分支'), 'main');
  await click(btn('预览改动', '.pr-create button'));
  await wait(
    w,
    "document.querySelector('.pr-create__preview')?.textContent.includes('automatic suggestion')",
  );
  assert.equal(await ev('(' + aria('PR/MR 标题') + ').value'), newTitle);
  assert.equal(
    await ev('(' + aria('PR/MR 描述') + ').value'),
    'Only sent to the disposable HTTPS peer.',
  );
  await record(
    ['UI-012'],
    'late branch previews retain typed title and body; selecting the source as target blocks creation, and explicit refresh to main preserves both fields',
  );
  await click(btn('指派人、审阅者和标签（可选）', '.pr-create summary'));
  await select('指派人', 'Fixture Member (@fixture-member)');
  await select('审阅者', 'Fixture Member (@fixture-member)');
  await select('标签', 'fixture-label');
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
    'create one draft MR with the selected assignee, reviewer and label for the previewed source branch and open the returned request; the controlled peer verifies exact IDs, fields and one POST',
  );
  await click(aria('返回列表'));
  await click(btn('创建 PR/MR'));
  await wait(w, btn('打开 Draft: ' + newTitle));
  assert.equal(await ev('(' + btn('创建 PR/MR', '.a-dlg-actions button') + ').disabled'), true);
  await click(btn('打开 Draft: ' + newTitle));
  await wait(
    w,
    "document.querySelector('.pull-request-detail__heading h2')?.textContent.includes(" +
      JSON.stringify(newTitle) +
      ')',
  );
  await record(
    ['UI-012', 'UI-031', 'UI-032'],
    'an existing request for the same branch disables duplicate creation; opening it selects the original returned request without another POST',
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
  const sourceConfiguration = "[...document.querySelectorAll('.pr-center-sources section')].find(e=>e.querySelector('strong')?.textContent.includes('review-project'))";
  const configure = '(' + sourceConfiguration + ')?.querySelector("button")';
  await click(configure);
  await wait(w, '(' + sourceConfiguration + ')?.querySelector(".pr-center-source-config")');
  assert.equal(await ev('(' + sourceConfiguration + ')?.querySelector(".pr-center-source-config input")?.getAttribute("aria-label")'), '访问令牌 review-project origin');
  await click(configure);
  await wait(w, '!(' + sourceConfiguration + ')?.querySelector(".pr-center-source-config")');
  await click(btn('重新发现与读取', '.pr-center-drawer button'));
  await wait(w, "!document.querySelector('.pr-center-drawer .ant-btn-loading')");
  await record(['UI-069'], 'center source configuration opens for the exact repository and remote, closes without changing credentials, and rediscovery completes');
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
    await wait(
      w,
      `(()=>{const e=(${aria('筛选状态')})?.closest('.ant-select');if(!e)return false;e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`,
    );
    await wait(w, btn('已关闭', '.ant-select-item-option'));
    await ev(
      `(()=>{const option=(${btn('已关闭', '.ant-select-item-option')}),clear=(${btn('清除筛选', '.pr-center-drawer button')});if(!option||!clear)throw Error('Expected active filter controls');clear.click();option.click()})()`,
    );
    await wait(
      w,
      "new URLSearchParams(location.search).get('state')==='closed'&&!new URLSearchParams(location.search).has('q')",
    );
    await hideFilters();
    const rapidClosed = `[...document.querySelectorAll('${centerList}')].find(e=>e.textContent==='Archived fixture request')`;
    await wait(w, rapidClosed);
    assert.equal(await ev('Boolean(' + centerRow + ')'), false);
    await record(
      ['UI-069'],
      'clear search and select closed in one renderer turn: the state patch merges with the reset query, rather than restoring the previous title search',
    );
    await showFilters();
    await select('筛选状态', '已关闭');
    await click(btn('清除筛选', '.pr-center-drawer button'));
    await wait(
      w,
      "!new URLSearchParams(location.search).has('q')&&[...document.querySelectorAll('input[aria-label=\"搜索 PR/MR\"]')].every(e=>e.value==='')",
    );
    await hideFilters();
    await wait(w, centerRow);
    await showFilters();
    await select('筛选状态', '已关闭');
    await hideFilters();
    await wait(
      w,
      "new URLSearchParams(location.search).get('state')==='closed'&&!new URLSearchParams(location.search).has('q')",
    );
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
