const assert = require('node:assert/strict');
const { nativeTheme } = require('electron');
module.exports = async ({ window, origin, token }) => {
  const fixture = JSON.parse(process.env.ALUNE_CODE_FIXTURE);
  const api = async (route, body) => {
    const response = await fetch(origin + '/api' + route, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, route + ': ' + response.status);
    return response.json();
  };
  const connection = await api('/connections', {
    ...fixture.connection,
    name: 'Code appearance fixture',
    authType: 'password',
  });
  const ssh = await api('/repositories', { connectionId: connection.id, path: fixture.path });
  const local = await api('/repositories', { source: 'local', path: fixture.path });
  const execute = (script) => window.webContents.executeJavaScript(script);
  const wait = (expression) =>
    execute(
      `new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>{if(${expression})return resolve();if(Date.now()-start>10000)return reject(Error('Code files timeout: '+${JSON.stringify(expression)}));setTimeout(poll,30)};poll()})`,
    );
  const chooseFile = async (name) => {
    await wait(
      `[...document.querySelectorAll('.files-tree__item')].some(el=>el.textContent.includes(${JSON.stringify(name)}))`,
    );
    await execute(
      `[...document.querySelectorAll('.files-tree__item')].find(el=>el.textContent.includes(${JSON.stringify(name)})).click()`,
    );
    await wait(
      `document.querySelector('.files-code')?.getAttribute('aria-label') === ${JSON.stringify(name + ' 的内容')}`,
    );
  };
  try {
    nativeTheme.themeSource = 'light';
    await window.loadURL(origin + '/settings/appearance');
    await wait("document.querySelector('input[value=dark]')");
    await execute("document.querySelector('input[value=dark]').click()");
    await wait("document.querySelector('.files-code')?.dataset.codeTheme === 'catppuccin-mocha'");
    await execute(
      `document.querySelector('#code-theme').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
    );
    await wait(
      "Array.from(document.querySelectorAll('.ant-select-item-option')).some(option => option.title === 'Catppuccin Macchiato · 深色')",
    );
    await execute(
      `Array.from(document.querySelectorAll('.ant-select-item-option')).find(option => option.title === 'Catppuccin Macchiato · 深色').click()`,
    );
    await wait(
      "document.querySelector('.files-code')?.dataset.codeTheme === 'catppuccin-macchiato'",
    );
    await execute("document.querySelector('input[value=system]').click()");
    await wait("document.querySelector('.files-code')?.dataset.codeTheme === 'catppuccin-latte'");
    for (const repo of [local, ssh]) {
      nativeTheme.themeSource = 'light';
      await window.loadURL(origin + '/repositories/' + repo.id);
      await wait('document.querySelector("button[aria-label=文件]")');
      await execute('document.querySelector("button[aria-label=文件]").click()');
      await chooseFile('example.ts');
      await wait("document.querySelector('.files-code .token.keyword')");
      assert.equal(
        await execute("getComputedStyle(document.querySelector('.token.keyword')).color"),
        'rgb(136, 57, 239)',
      );
      // Repository notices can take focus after loading; dismiss before testing text selection.
      await execute('document.querySelector(\'button[aria-label="关闭提示"]\')?.click()');
      await wait('!document.querySelector(\'button[aria-label="关闭提示"]\')');
      await execute(`(() => {
        window.codeNode = document.querySelector('.files-code'); window.codeNode.scrollTop = 120;
        const token = document.querySelector('.files-code .token.keyword'); window.selectedCodeToken = token; const range = document.createRange(); range.selectNodeContents(token);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      })()`);
      nativeTheme.themeSource = 'dark';
      await wait(
        "document.querySelector('.files-code').dataset.codeTheme === 'catppuccin-macchiato'",
      );
      assert.equal(
        await execute(
          'window.codeNode === document.querySelector(".files-code") && window.codeNode.scrollTop === 120',
        ),
        true,
      );
      assert.equal(
        await execute(
          "window.selectedCodeToken === document.querySelector('.files-code .token.keyword')",
        ),
        true,
      );
      assert.equal(await execute('getSelection().toString()'), 'export');
      assert.equal(
        await execute("getComputedStyle(document.querySelector('.token.keyword')).color"),
        'rgb(198, 160, 246)',
      );
      // Use client navigation, as the settings shortcut does, without restarting the renderer.
      await execute(
        "history.pushState({}, '', '/settings/appearance'); dispatchEvent(new PopStateEvent('popstate'))",
      );
      await wait("document.getElementById('code-font-size')");
      await execute(`(() => {
        const input = document.getElementById('code-font-size');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '18');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await execute('history.back()');
      // Settings deliberately retain the file DOM; wait for the route before interacting.
      await wait(`location.pathname === ${JSON.stringify('/repositories/' + repo.id)}`);
      await wait(
        "document.querySelector('.files-code')?.getAttribute('aria-label') === 'example.ts 的内容'",
      );
      await wait("document.querySelector('.files-code').scrollTop === 120");
      assert.equal(
        await execute("getComputedStyle(document.querySelector('.files-code__content')).fontSize"),
        '18px',
      );
      const lines = await execute(
        "['.files-code__gutter','.files-code__content'].map(s=>getComputedStyle(document.querySelector(s)).lineHeight)",
      );
      assert.equal(lines[0], lines[1]);
      for (const name of ['example.py', 'example.json']) {
        await chooseFile(name);
        await wait("document.querySelector('.files-code .token.string')");
        assert.equal(
          await execute("getComputedStyle(document.querySelector('.token.string')).color"),
          'rgb(166, 218, 149)',
        );
      }
      await chooseFile('unknown.custom');
      assert.equal(
        await execute("document.querySelector('.files-code__content').textContent"),
        'Plain text <content>',
      );
      assert.equal(await execute("document.querySelector('.files-code .token') === null"), true);
      await chooseFile('large.ts');
      assert.equal(
        await execute(
          "document.querySelector('.files-code .token') === null && document.body.innerText.includes('已关闭语法高亮')",
        ),
        true,
      );
      console.log(
        `Code appearance passed for ${repo.source}: TypeScript/Python/JSON, unknown/large fallbacks, OS mode changes, per-mode theme, aligned gutters, selection and scroll preservation.`,
      );
    }
  } catch (error) {
    console.error(await execute(`({ path: location.pathname, text: document.body.innerText })`));
    throw error;
  } finally {
    nativeTheme.themeSource = 'system';
  }
};
