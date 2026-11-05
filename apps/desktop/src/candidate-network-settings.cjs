// Only contact the disposable test proxy. An .invalid destination makes a
// successful HEAD and a recorded CONNECT independent proof of correct routing.
const http = require('node:http'),
  net = require('node:net'),
  assert = require('node:assert/strict');
module.exports = async ({
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
}) => {
  const ev = (s) => wc.executeJavaScript(s),
    open = (p) => window.loadURL(origin + p),
    name = 'Offline proxy fixture';
  const has = (expr, t) => '(' + expr + ')?.textContent.includes(' + JSON.stringify(t) + ')';
  const enabled = button('启用网络代理'),
    host = button('代理服务器地址'),
    port = button('代理端口');
  const fixture = await new Promise((resolve, reject) => {
    const sockets = new Set();
    let calls = 0,
      tunnels = 0;
    const upstream = http.createServer((req, res) => {
      if (req.method !== 'HEAD' || req.url !== '/proof') return res.writeHead(404).end();
      calls++;
      res.writeHead(204).end();
    });
    const proxy = http.createServer((_, res) => res.writeHead(405).end());
    for (const s of [upstream, proxy])
      s.on('connection', (c) => {
        sockets.add(c);
        c.once('close', () => sockets.delete(c));
        c.on('error', () => {});
      });
    proxy.on('connect', (req, client, bytes) => {
      if (req.url !== 'alune-acceptance.invalid:80') {
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      tunnels++;
      const remote = net.connect(upstream.address().port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (bytes.length) remote.write(bytes);
        remote.pipe(client).pipe(remote);
      });
      sockets.add(remote);
      remote.once('close', () => {
        sockets.delete(remote);
        client.destroy();
      });
      client.once('close', () => remote.destroy());
      remote.on('error', () => client.destroy());
    });
    upstream.once('error', reject);
    proxy.once('error', (e) => {
      upstream.close();
      reject(e);
    });
    upstream.listen(0, '127.0.0.1', () =>
      proxy.listen(0, '127.0.0.1', () =>
        resolve({
          port: proxy.address().port,
          facts: () => ({ calls, tunnels }),
          close: async () => {
            for (const s of sockets) s.destroy();
            await Promise.all([upstream, proxy].map((s) => new Promise((ok) => s.close(ok))));
          },
        }),
      ),
    );
  });
  try {
    await open('/connections');
    await click(textButton('添加连接'));
    await wait(wc, '(' + footer('保存连接') + ')?.disabled===true');
    await input(element('input[placeholder="构建服务器"]'), name);
    await input(element('input[placeholder="192.168.1.100"]'), '127.0.0.1');
    await input(element('input[placeholder="developer"]'), 'fixture');
    const sshAgent = element('.a-dlg-shell [role=radio][data-value=sshAgent]');
    await click(sshAgent);
    await wait(
      wc,
      "[...document.querySelectorAll('.a-dlg-shell [role=radio][aria-checked=true]')].some(e=>e.textContent.includes('SSH Agent'))",
    );
    await click(footer('保存连接'));
    await wait(wc, button('删除 ' + name));
    await click(button('刷新连接'));
    await wait(wc, button('删除 ' + name));
    await open('/connections');
    await wait(wc, button('删除 ' + name));
    await pass(
      ['UI-067'],
      'invalid SSH profile cannot submit; save and reload a named SSH Agent profile without a password or connection attempt',
    );
    // With password authentication selected, the form may submit an explicit
    // undefined password. It remains a valid saved profile with no secret.
    await click(textButton('添加连接'));
    const blank = 'No saved password';
    await input(element('input[placeholder="构建服务器"]'), blank);
    await input(element('input[placeholder="192.168.1.100"]'), '127.0.0.1');
    await input(element('input[placeholder="developer"]'), 'fixture');
    await click(footer('保存连接'));
    await wait(wc, button('删除 ' + blank));
    await click(button('列表视图'));
    await wait(wc, element('table[aria-label="连接列表"]'));
    await wait(
      wc,
      "[...document.querySelectorAll('.connection-table tr')].some(e=>e.textContent.includes('No saved password') && e.textContent.includes('密码'))",
    );
    await click(button('卡片视图'));
    await wait(wc, button('删除 ' + blank));
    await click(button('删除 ' + blank));
    await click(textButton('删除连接'));
    await wait(wc, '!(' + button('删除 ' + blank) + ')');
    await pass(
      ['UI-009', 'UI-067'],
      'save a password profile with its optional password left blank, inspect the authentication method in list view and remove that isolated profile from card view',
    );
    await open('/settings/proxy');
    await wait(wc, enabled);
    assert.equal(await ev('(' + enabled + ').getAttribute("aria-checked")'), 'false');
    const oldHost = await ev('(' + host + ').value'),
      oldPort = await ev('(' + port + ').value');
    await select('代理类型', 'SOCKS5');
    await input(host, 'should-not-persist.invalid');
    await click(textButton('放弃修改'));
    await wait(wc, '(' + host + ').value===' + JSON.stringify(oldHost));
    await click(enabled);
    await select('代理类型', 'HTTP');
    await input(host, '127.0.0.1');
    await input(port, String(fixture.port));
    await click(textButton('保存配置'));
    await wait(
      wc,
      '(' +
        textButton('保存配置') +
        ')?.disabled===true && !document.querySelector("fieldset:disabled")',
    );
    await open('/settings/proxy');
    await wait(
      wc,
      '(' +
        enabled +
        ')?.getAttribute("aria-checked")==="true" && (' +
        port +
        ')?.value===' +
        JSON.stringify(String(fixture.port)),
    );
    await input(button('HTTP 测试地址'), 'http://alune-acceptance.invalid/proof');
    await click(textButton('测试 HTTP'));
    const deadline = Date.now() + 12000;
    while (!fixture.facts().calls) {
      if (Date.now() > deadline) throw Error('Proxy HEAD did not reach its endpoint');
      await new Promise((r) => setTimeout(r, 50));
    }
    await wait(
      wc,
      '(' + textButton('测试 HTTP') + ')?.classList.contains("ant-btn-loading")===false',
    );
    const feedback = await ev("document.querySelector('.feedback-dialog[open]')?.innerText");
    if (feedback) {
      assert.match(feedback, /204|成功|HTTP.*可/);
      await click(element('.feedback-dialog[open] [aria-label="关闭提示"]'));
    }
    assert.ok(fixture.facts().tunnels > 0);
    assert.equal(fixture.facts().calls, 1);
    await wait(wc, has(element('[aria-label="服务器代理状态"]'), name));
    await pass(
      ['UI-060'],
      'discard unsaved proxy edits, save and reload HTTP host/port, route a HEAD through the loopback proxy and inspect the offline SSH profile',
    );
    await click(enabled);
    await input(host, oldHost);
    await input(port, oldPort);
    await click(textButton('保存配置'));
    await wait(
      wc,
      '(' +
        textButton('保存配置') +
        ')?.disabled===true && !document.querySelector("fieldset:disabled")',
    );
    await open('/settings/proxy');
    await wait(
      wc,
      '(' +
        enabled +
        ')?.getAttribute("aria-checked")==="false" && (' +
        port +
        ')?.value===' +
        JSON.stringify(oldPort),
    );
    await open('/connections');
    await click(button('删除 ' + name));
    await click(textButton('取消'));
    await wait(wc, '!(' + textButton('删除连接') + ')');
    await wait(wc, button('删除 ' + name));
    await click(button('删除 ' + name));
    await click(textButton('删除连接'));
    await wait(wc, '!(' + button('删除 ' + name) + ')');
    await open('/settings/proxy');
    await wait(wc, element('[aria-label="服务器代理状态"]'));
    assert.equal(await ev(has(element('[aria-label="服务器代理状态"]'), name)), false);
    await pass(
      ['UI-067', 'UI-060'],
      'cancel deletion preserves the profile; confirmed deletion removes it from both connections and the saved proxy status view',
    );
  } finally {
    await fixture.close();
  }
};
