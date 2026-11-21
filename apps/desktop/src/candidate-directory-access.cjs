const assert = require('node:assert/strict');
module.exports = async ({ window, origin, wait, pass }) => {
  const wc = window.webContents,
    ev = (s) => wc.executeJavaScript(s);
  const { element, button, textButton, click, input } = require('./candidate-ui-driver.cjs')(
    wc,
    wait,
  );
  const { port, hostKey, notes } = JSON.parse(process.env.ALUNE_TEST_DIRECTORY_ACCESS);
  const name = 'Explicit directory fixture',
    primary = (t) => textButton(t, '.a-dlg-actions button');
  await window.loadURL(origin + '/connections');
  const addProfile = async () => {
    await click(textButton('添加连接'));
    for (const [field, value] of [
      ['name', name],
      ['host', '127.0.0.1'],
      ['port', String(port)],
      ['username', 'fixture'],
    ])
      await input(element('#' + field), value);
    await click(element('[role=radio][data-value=sshAgent]'));
    await click(primary('保存连接'));
  };
  await addProfile();
  const row =
    '[...document.querySelectorAll(".connection-card,.connection-table tbody tr")].find(e=>e.getClientRects().length&&e.querySelector(".connection-card__title .collection-text")?.textContent.trim()===' +
    JSON.stringify(name) +
    ')';
  const action = (title) =>
    '([...(' +
    row +
    ')?.querySelectorAll("button")??[]].find(e=>e.textContent.replace(/\\s/g,"")===' +
    JSON.stringify(title) +
    '))';
  const dismiss = () =>
    wait(
      wc,
      `(()=>{const n=document.querySelector('.feedback-dialog[open]');if(!n)return true;if(n.dataset.tone==='error')throw Error(n.innerText);n.querySelector('[aria-label="关闭提示"]').click();return false})()`,
    );
  async function connect(first) {
    await click(action('测试连接'));
    await wait(wc, primary(first ? '信任并连接' : '连接'));
    if (first) {
      assert.equal(await ev('Boolean(' + button('SSH 主机公钥 SHA-256 指纹') + ')'), false);
      assert.equal(await ev('Boolean(' + element('.a-dlg-shell input[type=checkbox]') + ')'), false);
    } else assert.equal(await ev('(' + button('SSH 主机公钥 SHA-256 指纹') + ').value'), hostKey);
    await click(primary(first ? '信任并连接' : '连接'));
    // The first SSH connection installs and unpacks the packaged Agent.
    await wait(wc, '(' + row + ')?.innerText.includes("在线")', 'SSH fixture online', 120_000);
    await dismiss();
  }
  await connect(true);
  await click(action('目录授权'));
  const list = element('ul[aria-label="已授权目录"]');
  await wait(wc, '(' + list + ')?.getAttribute("aria-busy")==="false"');
  assert.equal(await ev('(' + list + ').children.length'), 0);
  assert.equal(
    await ev('(' + element('[role=radio][data-value=read]') + ').getAttribute("aria-checked")'),
    'true',
  );
  assert.equal(await ev('(' + primary('授权此目录') + ').disabled'), true);
  await input(element('#directory-access-path'), notes);
  await click(primary('授权此目录'));
  await wait(
    wc,
    '(' +
      list +
      ')?.children.length===1&&(' +
      list +
      ').innerText.includes("读取")&&document.querySelector("#directory-access-path")?.value===""',
  );
  assert.equal(await ev('(' + list + ').querySelector("code").textContent'), notes);
  await pass(
    ['UI-067'],
    'connect to the disposable pinned SSH peer, then explicitly authorize its exact canonical directory with read-only access by default',
  );
  await click(element('[role=radio][data-value=read-write]'));
  await input(element('#directory-access-path'), notes);
  await click(primary('授权此目录'));
  await wait(
    wc,
    '(' +
      list +
      ')?.children.length===2&&document.querySelector("#directory-access-path")?.value===""',
  );
  const ro = '[...(' + list + ').children].find(e=>e.innerText.includes("读取"))';
  await click('(' + ro + ').querySelector("button")');
  await wait(wc, '(' + list + ')?.children.length===1&&(' + list + ').innerText.includes("读写")');
  await click(primary('取消'));
  await window.loadURL(origin + '/connections');
  await connect(false);
  await click(action('目录授权'));
  await wait(wc, '(' + list + ')?.getAttribute("aria-busy")==="false"');
  assert.equal(await ev('(' + list + ').children.length'), 0);
  await pass(
    ['UI-067'],
    'explicitly choose read-write access, revoke the separate read grant and reload the real renderer; reconnecting to the same pinned Agent starts with no inherited directory grants',
  );
  await click(primary('取消'));
  await click(button('删除 ' + name));
  await click(textButton('删除连接', '.ant-popconfirm-buttons button'));
  await wait(wc, '!(' + row + ')');
  await addProfile();
  await connect(true);
  await click(action('目录授权'));
  await wait(wc, '(' + list + ')?.getAttribute("aria-busy")==="false"');
  assert.equal(await ev('(' + list + ').children.length'), 0);
  await click(primary('取消'));
  await click(button('删除 ' + name));
  await click(textButton('删除连接', '.ant-popconfirm-buttons button'));
  await wait(wc, '!(' + row + ')');
  await pass(
    ['UI-067'],
    'remove the SSH profile and explicitly trust a newly created profile for that same persistent Agent; deleted cached ownership does not block reconnect or restore old directory grants',
  );
};
