// Workspace settings on the disposable candidate only. Reopen pages to
// distinguish persisted Agent values from drafts retained in React.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
module.exports = async ({
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
}) => {
  const open = (page) => window.loadURL(origin + '/settings/' + page),
    ev = (expr) => wc.executeJavaScript(expr);
  const input = async (expr, value) =>
    wait(
      wc,
      `(()=>{const e=(${expr});if(!e||e.disabled||e.readOnly)return false;e.focus();Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    );
  const select = async (label, name) => {
    const el = button(label);
    await wait(
      wc,
      `(()=>{const e=(${el})?.closest('.ant-select');if(!e||e.classList.contains('ant-select-disabled'))return false;e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`,
    );
    await click(
      `[...document.querySelectorAll('.ant-select-item-option')].find(e=>e.getClientRects().length && (e.title===${JSON.stringify(name)}||e.textContent.trim()===${JSON.stringify(name)}))`,
    );
  };
  const footer = (label) =>
    `[...document.querySelectorAll('.a-dlg-actions button')].find(e=>e.getClientRects().length&&!e.closest('[inert]')&&e.textContent.replace(/\\s/g,'')===${JSON.stringify(label)})`;
  const isValue = (expr, val) => '(' + expr + ')?.value===' + JSON.stringify(val);
  const provider = 'Local acceptance',
    model = 'local-parity',
    nickname = 'Local Model';
  // The configured provider is a loopback server owned by this test. Its
  // results exercise the renderer and actual Agent HTTP transport without
  // external accounts, credentials or network writes.
  let modelReads = 0,
    tested = 0,
    drafts = 0,
    hold = false,
    held = 0,
    cancelled = 0;
  const api = require('node:http').createServer(async (req, res) => {
    const chunks = [];
    for await (const b of req) chunks.push(b);
    if (req.method === 'GET' && req.url === '/v1/models') {
      modelReads++;
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'discovered-fixture' }] }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks));
    const messages = JSON.stringify(body.messages);
    if (hold) {
      held++;
      res.on('close', () => cancelled++);
      return;
    }
    let content = 'OK';
    if (messages.includes('changed in legacy workspace')) {
      if (messages.includes('keep the working tree separate') || body.model !== model) {
        res.writeHead(400).end();
        return;
      }
      drafts++;
      content = JSON.stringify({
        message: 'generated fixture summary',
        description: 'generated fixture body',
      });
    } else tested++;
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((ok, fail) => {
    api.once('error', fail);
    api.listen(0, '127.0.0.1', ok);
  });
  const url = 'http://127.0.0.1:' + api.address().port + '/v1';
  const fact = async (fn, why) => {
    const until = Date.now() + 10000;
    while (!fn()) {
      if (Date.now() > until) throw Error(why);
      await new Promise((ok) => setTimeout(ok, 40));
    }
  };
  try {
    await open('providers');
    await click(textButton('自定义服务商'));
    await input(button('服务商名称'), provider);
    await input(button('API 地址'), url);
    const add = element('.provider-models .settings-inline-actions button:last-child');
    await click(add);
    await input(button('模型 ID'), model);
    await input(button('模型显示名称'), 'Original label');
    await click(footer('添加模型'));
    await click(button('编辑模型 ' + model));
    await input(button('模型显示名称'), nickname);
    await click(footer('应用修改'));
    await click(button('启用模型 ' + model));
    await wait(wc, '(' + button('启用模型 ' + model) + ')?.getAttribute("aria-checked")==="false"');
    await click(button('启用模型 ' + model));
    await wait(wc, '(' + button('启用模型 ' + model) + ')?.getAttribute("aria-checked")==="true"');
    await click(textButton('保存配置'));
    const card = `[...document.querySelectorAll('.provider-list__item')].find(e=>e.textContent.includes(${JSON.stringify(provider)}))`;
    await wait(wc, '(' + card + ')');
    await open('providers');
    await input(button('搜索服务商'), provider);
    await wait(wc, "document.querySelectorAll('.provider-list__item').length===1");
    await click(card);
    await wait(wc, isValue(button('服务商名称'), provider));
    await wait(wc, isValue(button('API 地址'), url));
    await wait(wc, button('编辑模型 ' + model));
    assert.ok(
      await ev("document.querySelector('.provider-models').innerText.includes('Local Model')"),
    );
    await pass(
      ['UI-059'],
      'create offline provider and manual model, edit its display name, disable/re-enable, save and find the persisted configuration after reload',
    );

    await click(textButton('获取模型'));
    await wait(wc, button('编辑模型 discovered-fixture'));
    assert.equal(modelReads, 1);
    // Choose the saved model explicitly so testing issues a chat request.
    await select('测试模型', nickname + ' (' + model + ')');
    hold = true;
    await click(textButton('测试连接'));
    await fact(() => held === 1, 'test did not reach loopback provider');
    await click(textButton('取消请求'));
    await fact(() => cancelled === 1, 'cancel did not close provider request');
    hold = false;
    await click(textButton('测试连接'));
    await fact(() => tested === 1, 'saved model was not tested');
    await wait(wc, '(' + textButton('测试连接') + ')?.disabled===false');
    await pass(
      ['UI-059'],
      'discover a model from a loopback provider, cancel an in-flight connection test, then verify a fresh explicit test reaches the configured service',
    );
    await open('commit');
    await select('默认服务商', provider);
    await select('默认模型', nickname + ' · ' + model);
    await select('输出语言', 'English');
    await select('提交格式', '自然语言');
    const prompt = 'Use the saved fixture preference.';
    await input(button('补充提示词'), prompt);
    await click(textButton('保存设置'));
    // Wait for the actual submit to finish before tearing down its channel.
    // Reopen only once and require freshly loaded values without replaying a save.
    async function reopened(page, condition) {
      await wait(wc, "!document.querySelector('fieldset.settings-fieldset:disabled')");
      await open(page);
      await wait(wc, element('fieldset'));
      await wait(wc, condition);
    }
    await reopened('commit', isValue(button('补充提示词'), prompt));
    for (const [key, name] of [
      ['默认服务商', provider],
      ['默认模型', nickname],
      ['输出语言', 'English'],
      ['提交格式', '自然语言'],
    ]) {
      assert.ok(
        await ev(
          '(' +
            button(key) +
            ')?.closest(".ant-select")?.textContent.includes(' +
            JSON.stringify(name) +
            ')',
        ),
        key,
      );
    }
    await pass(
      ['UI-057'],
      'select persisted provider/model, English and natural language format; reopen to verify all values and custom prompt',
    );
    await window.loadURL(origin + '/repositories/' + id);
    await wait(wc, button('取消暂存 candidate.txt'));
    await wait(wc, button('AI 模型 ' + nickname + '，打开提交生成设置'));
    const summary = button('提交摘要'),
      description = button('提交描述');
    await input(summary, 'handwritten summary');
    await input(description, 'handwritten body');
    await click(button('AI 生成提交信息'));
    await wait(wc, isValue(summary, 'generated fixture summary'));
    assert.equal(await ev('(' + description + ').value'), 'generated fixture body');
    assert.equal(drafts, 1);
    await click(textButton('撤销生成'));
    await wait(wc, isValue(summary, 'handwritten summary'));
    assert.equal(await ev('(' + description + ').value'), 'handwritten body');
    assert.equal(
      require('node:child_process').execFileSync('git', ['-C', repo, 'show', ':candidate.txt'], {
        encoding: 'utf8',
      }),
      'changed in legacy workspace\n',
    );
    await input(summary, '');
    await input(description, '');
    await pass(
      ['UI-007'],
      'generate using the selected model and real staged bytes, exclude a distinct unstaged sentinel, undo to both original draft fields and preserve the Git index',
    );
    await open('commit');
    await click(textButton('管理服务商'));
    await wait(wc, isValue(button('服务商名称'), provider));
    await click(button('删除模型 ' + model));
    await click(footer('取消'));
    await wait(wc, button('编辑模型 ' + model));
    await click(button('删除模型 ' + model));
    await click(footer('删除模型'));
    await click(textButton('保存配置'));
    await wait(
      wc,
      "[...document.querySelectorAll('.provider-detail .settings-muted')].some(e=>e.textContent==='已保存')",
    );
    await reopened(
      'commit',
      '!(' +
        button('默认模型') +
        ')?.closest(".ant-select")?.textContent.includes(' +
        JSON.stringify(nickname) +
        ')',
    );
    await wait(wc, isValue(button('补充提示词'), prompt));
    await pass(
      ['UI-057', 'UI-059', 'UI-061', 'UI-025'],
      'cancel model deletion then confirm and persist it; removing the default clears the selection without losing the saved prompt',
    );

    await open('logs');
    const dir = path.join(path.dirname(repo), 'dedicated-test-logs');
    fs.mkdirSync(dir, { recursive: true });
    await input(button('自定义日志目录'), dir);
    await input(button('保留天数'), '8');
    await input(button('总大小上限'), '42');
    await click(textButton('保存设置'));
    await reopened('logs', isValue(button('自定义日志目录'), dir));
    assert.equal(await ev('(' + button('保留天数') + ').value'), '8');
    assert.equal(await ev('(' + button('总大小上限') + ').value'), '42');
    await pass(
      ['UI-058'],
      'save an isolated log directory and retention limits, reload and verify directory, days and megabytes',
    );
    await open('layout');
    await wait(wc, element('.layout-settings'));
    const persisted = '(async()=>JSON.parse(await window.aluneWorkspace.load()).state)()';
    const storedLayout = async (expected) => {
      const until = Date.now() + 10000;
      let selected;
      do {
        const { layout } = await ev(persisted);
        selected = Object.fromEntries(Object.keys(expected).map((key) => [key, layout[key]]));
        if (Object.keys(expected).every((key) => selected[key] === expected[key])) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      } while (Date.now() < until);
      assert.deepEqual(selected, expected, 'native layout preferences did not settle');
    };
    const treeSettings = (s) => [
      s.collapsedConnectionIds,
      s.connectionOrder,
      s.repositoryOrderByConnection,
    ];
    const treeBefore = treeSettings(await ev(persisted));
    await click(textButton('恢复默认布局'));
    const defaults = {
      sidebarWidth: 236,
      changesWidth: 320,
      diffMode: 'unified',
      sidebarCollapsed: false,
      changesCollapsed: false,
    };
    await storedLayout(defaults);
    await input(button('工作区宽度'), '308');
    await input(button('右侧面板宽度'), '468');
    await click(element('.layout-settings .ant-segmented-item:last-child'));
    await click(button('显示左侧工作区'));
    await click(button('显示右侧面板'));
    await storedLayout({
      sidebarWidth: 308,
      changesWidth: 468,
      diffMode: 'split',
      sidebarCollapsed: true,
      changesCollapsed: true,
    });
    await open('layout');
    await wait(wc, isValue(button('工作区宽度'), '308'));
    assert.equal(await ev('(' + button('右侧面板宽度') + ').value'), '468');
    for (const label of ['显示左侧工作区', '显示右侧面板'])
      assert.equal(await ev('(' + button(label) + ').getAttribute("aria-checked")'), 'false');
    assert.equal(
      await ev(
        "document.querySelector('.layout-settings .ant-segmented-item-selected')?.textContent.trim()",
      ),
      '分栏',
    );
    await pass(
      ['UI-026'],
      'change both panel widths, visibility and Diff mode; verify native persistence and reopen settings',
    );
    await click(textButton('恢复默认布局'));
    await storedLayout(defaults);
    assert.deepEqual(treeSettings(await ev(persisted)), treeBefore);
    await pass(
      ['UI-026'],
      'reset layout to the original dimensions and unified Diff while preserving workspace tree groups and order',
    );
    await require('./candidate-network-settings.cjs')({
      window,
      origin,
      wc,
      wait,
      element,
      button,
      textButton,
      click,
      input,
      select,
      footer,
      pass,
    });
    await window.loadURL(origin + '/repositories/' + id);
    await wait(wc, button('取消暂存 candidate.txt'));
  } finally {
    api.closeAllConnections();
    await new Promise((ok) => api.close(ok));
  }
};
