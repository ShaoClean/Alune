const assert = require('node:assert/strict');

module.exports = async ({ window, origin, restore }) => {
  const execute = (script) => window.webContents.executeJavaScript(script);
  const wait = (condition) =>
    execute(`new Promise((resolve, reject) => {
    const start = Date.now(); const poll = () => {
      if (${condition}) return resolve();
      if (Date.now() - start > 8000) return reject(Error('Code appearance timeout: ' + document.body.innerText));
      setTimeout(poll, 30);
    }; poll();
  })`);
  const select = (selector, value) =>
    execute(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const active = () => execute(`document.querySelector('.files-code').dataset.codeTheme`);
  await window.loadURL(`${origin}/settings/appearance`);
  await wait("document.querySelector('.files-code .token.keyword') !== null");
  if (restore) {
    const saved = JSON.parse(await execute('window.aluneWorkspace.load()')).state.codeAppearance;
    assert.equal(saved.fontFamily, 'Missing Fixture Mono');
    assert.equal(saved.fontSize, 18);
    assert.equal(saved.customThemes.length, 1);
    assert.equal(await active(), saved.darkTheme);
    assert.equal(
      await execute("getComputedStyle(document.querySelector('.files-code')).backgroundColor"),
      'rgb(17, 34, 51)',
    );
    assert.equal(
      await execute("getComputedStyle(document.querySelector('.token.keyword')).color"),
      'rgb(170, 187, 204)',
    );
    console.log(
      'Desktop custom code theme, font and size survived process restart and a changed HTTP origin.',
    );
    return;
  }
  const selector = 'select[aria-describedby="code-theme-mode-hint"]';
  assert.equal(await active(), 'catppuccin-mocha');
  assert.equal(
    await execute(
      `document.querySelector('${selector} option[value="catppuccin-latte"]').disabled`,
    ),
    true,
  );
  await select(selector, 'catppuccin-frappe');
  assert.equal(await active(), 'catppuccin-frappe');
  await execute(`document.querySelector('input[value=light]').click()`);
  await wait("document.querySelector('.files-code').dataset.codeTheme === 'catppuccin-latte'");
  await execute(`document.querySelector('input[value=dark]').click()`);
  await wait("document.querySelector('.files-code').dataset.codeTheme === 'catppuccin-frappe'");
  const theme = JSON.stringify({
    name: 'Desktop Fixture',
    type: 'dark',
    colors: { 'editor.background': '#112233' },
    tokenColors: [{ scope: 'keyword', settings: { foreground: '#aabbcc' } }],
  });
  await execute(`(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File([${JSON.stringify(theme)}], 'desktop-fixture.json', { type: 'application/json' }));
    const input = document.querySelector('input[type=file]'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait("document.querySelector('.code-theme-list')?.textContent.includes('Desktop Fixture')");
  assert.equal(await active(), 'catppuccin-frappe', 'install does not activate a theme');
  const installed = JSON.parse(await execute('window.aluneWorkspace.load()')).state.codeAppearance
    .customThemes[0];
  await select(selector, installed.id);
  await wait(
    "getComputedStyle(document.querySelector('.token.keyword')).color === 'rgb(170, 187, 204)'",
  );
  await execute(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [id, value] of [['code-font-family', 'Missing Fixture Mono'], ['code-font-size', '18']]) {
      const input = document.getElementById(id); set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await wait(
    "getComputedStyle(document.querySelector('.files-code__content')).fontSize === '18px'",
  );
  const metrics = await execute(`['.files-code__content', '.files-code__gutter'].map(selector => {
    const css = getComputedStyle(document.querySelector(selector)); return { family: css.fontFamily, lineHeight: css.lineHeight };
  })`);
  assert.deepEqual(metrics[0], metrics[1]);
  assert.match(metrics[0].family, /monospace$/);
  await window.loadURL(`${origin}/settings/appearance`);
  await wait(
    `document.querySelector('.files-code')?.dataset.codeTheme === ${JSON.stringify(installed.id)}`,
  );
  console.log(
    'Desktop code appearance UI passed: mode filtering, separate preferences, JSON import, token colors, missing-font fallback, aligned gutters and reload.',
  );
};
