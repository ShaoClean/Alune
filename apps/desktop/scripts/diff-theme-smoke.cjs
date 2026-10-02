const assert = require('node:assert/strict');
const { nativeTheme } = require('electron');
const { writeFile, mkdir, readFile } = require('node:fs/promises');
const path = require('node:path');
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
  const execute = (script) => window.webContents.executeJavaScript(script);
  const wait = (expression) =>
    execute(
      `new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>{if(${expression})return resolve();if(Date.now()-start>12000)return reject(Error('Diff theme timeout: '+${JSON.stringify(expression)}));setTimeout(poll,30)};poll()})`,
    );
  const click = async (selector) => {
    await wait(`document.querySelector(${JSON.stringify(selector)})`);
    await execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const shot = async (name) => {
    if (!process.env.ALUNE_DIFF_EVIDENCE) return;
    await execute('document.querySelector(\'button[aria-label="关闭提示"]\')?.click()');
    await wait('!document.querySelector(\'button[aria-label="关闭提示"]\')');
    await execute(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    await mkdir(process.env.ALUNE_DIFF_EVIDENCE, { recursive: true });
    await writeFile(
      path.join(process.env.ALUNE_DIFF_EVIDENCE, name + '.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
  };
  const chooseFile = async (name, view = 'changes') => {
    const selector = view === 'files' ? '.files-tree__item' : '.file-row__select';
    await wait(
      `[...document.querySelectorAll('${selector}')].some(el=>el.textContent.includes(${JSON.stringify(name)}))`,
    );
    await execute(
      `[...document.querySelectorAll('${selector}')].find(el=>el.textContent.includes(${JSON.stringify(name)})).click()`,
    );
  };
  const themeMatches = async (id, bg, keyword) => {
    await wait(
      `document.querySelector('.diff-shell__body')?.dataset.codeTheme===${JSON.stringify(id)} && document.querySelector('.diff-shell__body .token.keyword')`,
    );
    assert.equal(
      await execute(
        "getComputedStyle(document.querySelector('.diff-shell__body')).backgroundColor",
      ),
      bg,
    );
    assert.equal(
      await execute(
        "getComputedStyle(document.querySelector('.diff-shell__body .token.keyword')).color",
      ),
      keyword,
    );
    const gutter = await execute(
      "getComputedStyle(document.querySelector('.diff-line-number')).color",
    );
    assert.ok(gutter);
    assert.equal(
      await execute(
        "getComputedStyle(document.querySelector('.diff-code-row code, .diff-split-cell code')).fontSize",
      ),
      '18px',
    );
  };
  try {
    nativeTheme.themeSource = 'light';
    let repos;
    if (process.env.ALUNE_DIFF_RESTART === '1') {
      repos = await api('/repositories');
      for (const repo of repos) {
        await window.loadURL(origin + '/repositories/' + repo.id);
        await click('button[aria-label^="改动"]');
        await chooseFile('example.ts');
        await themeMatches(
          await readFile(path.join(process.env.ALUNE_SMOKE_DIR, 'diff-theme-id'), 'utf8'),
          'rgb(18, 35, 52)',
          'rgb(255, 204, 119)',
        );
      }
      console.log(
        'Diff theme restart passed: selected imported theme and font restored in a new Electron process, local and SSH.',
      );
      return;
    }
    const connection = await api('/connections', {
      ...fixture.connection,
      name: 'Diff theme fixture',
      authType: 'password',
    });
    repos = [
      await api('/repositories', { source: 'local', path: fixture.path }),
      await api('/repositories', { connectionId: connection.id, path: fixture.path }),
    ];
    // Real settings UI: choose mode/theme/font and import a theme through its file input.
    await window.loadURL(origin + '/settings/appearance');
    await click('input[value="dark"]');
    await wait('document.getElementById("code-font-size")');
    await execute(
      `(()=>{const input=document.getElementById('code-font-size');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'18');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await execute(
      `document.querySelector('#code-theme').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`,
    );
    await wait(
      "[...document.querySelectorAll('.ant-select-item-option')].some(el=>el.title==='Catppuccin Macchiato · 深色')",
    );
    await execute(
      "[...document.querySelectorAll('.ant-select-item-option')].find(el=>el.title==='Catppuccin Macchiato · 深色').click()",
    );
    const imported = {
      name: 'Acceptance Dark',
      type: 'dark',
      colors: {
        'editor.background': '#122334',
        'editor.foreground': '#eeeeee',
        'editorLineNumber.foreground': '#abcdee',
        'editorGutter.background': '#172a3d',
        'diffEditor.insertedLineBackground': '#1a3a30',
        'diffEditor.removedLineBackground': '#402532',
        'diffEditor.insertedTextBackground': '#285542',
        'diffEditor.removedTextBackground': '#663b4c',
      },
      tokenColors: [
        { scope: 'keyword', settings: { foreground: '#ffcc77' } },
        { scope: 'string', settings: { foreground: '#aadd99' } },
      ],
    };
    await execute(
      `(()=>{const input=document.querySelector('input[type=file]');const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(imported))}],'acceptance.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait("document.body.innerText.includes('Acceptance Dark')");
    for (const repo of repos) {
      await window.loadURL(origin + '/repositories/' + repo.id);
      await click('button[aria-label="文件"]');
      await chooseFile('example.ts', 'files');
      await wait("document.querySelector('.files-code .token.keyword')");
      assert.equal(
        await execute("getComputedStyle(document.querySelector('.files-code')).backgroundColor"),
        'rgb(36, 39, 58)',
      );
      await click('button[aria-label^="改动"]');
      await chooseFile('example.ts');
      await themeMatches('catppuccin-macchiato', 'rgb(36, 39, 58)', 'rgb(198, 160, 246)');
      // Live OS mode switch while a full-screen Diff remains mounted.
      nativeTheme.themeSource = 'light';
      await window.loadURL(origin + '/settings/appearance');
      await click('input[value="system"]');
      await window.loadURL(origin + '/repositories/' + repo.id);
      await click('button[aria-label^="改动"]');
      await chooseFile('example.ts');
      await themeMatches('catppuccin-latte', 'rgb(239, 241, 245)', 'rgb(136, 57, 239)');
      await click('button[aria-label="全屏查看差异"]');
      await wait("document.querySelector('dialog:modal')");
      nativeTheme.themeSource = 'dark';
      await themeMatches('catppuccin-macchiato', 'rgb(36, 39, 58)', 'rgb(198, 160, 246)');
      await execute("[...document.querySelectorAll('.diff-view-switch input')][1].click()");
      await wait("document.querySelector('.diff-split-view .token.keyword')");
      await shot(repo.source === 'local' ? 'desktop-local-fullscreen' : 'desktop-ssh-fullscreen');
      await click('button[aria-label="退出全屏查看"]');
      await chooseFile('example.py');
      await wait("document.querySelector('.diff-shell__body .token.string')");
      await chooseFile('example.ts');
      await wait("document.querySelector('.diff-shell__body .token.keyword')");
      await chooseFile('image.png');
      await wait("document.querySelectorAll('.image-diff-pane__canvas img').length===2");
      assert.equal(
        await execute(
          "document.querySelector('.diff-shell__body').hasAttribute('data-code-theme')",
        ),
        false,
      );
      assert.ok(
        await execute(
          "[...document.querySelectorAll('.image-diff-pane__canvas img')].every(img=>img.complete && img.naturalWidth>0)",
        ),
      );
      await click('button[aria-label="提交历史"]');
      await wait("document.querySelector('.history-row')");
      await click('.history-row');
      await wait("document.querySelector('.diff-shell__body .token.keyword')");
      assert.equal(
        await execute("document.querySelector('.diff-shell__body').dataset.codeTheme"),
        'catppuccin-macchiato',
      );
      await click('button[aria-label="查看提交文件 example.ts"]');
      await wait("document.querySelector('.diff-shell__body .token.keyword')");
      console.log(
        `Diff theme passed for ${repo.source}: preview/changes/history, unified/split/fullscreen, OS mode switch, image Diff, file reload.`,
      );
      // Restore explicit dark preference for next repository.
      await window.loadURL(origin + '/settings/appearance');
      await click('input[value="dark"]');
    }
    // Select imported theme and persist it across the real process restart.
    await execute(
      `document.querySelector('#code-theme').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`,
    );
    await wait(
      "[...document.querySelectorAll('.ant-select-item-option')].some(el=>el.title==='Acceptance Dark · 深色')",
    );
    await execute(
      "[...document.querySelectorAll('.ant-select-item-option')].find(el=>el.title==='Acceptance Dark · 深色').click()",
    );
    await wait("document.querySelector('.files-code')?.dataset.codeTheme.startsWith('custom-')");
    // The import id is intentionally random; persist it as evidence for the next process.
    const themeId = await execute("document.querySelector('.files-code').dataset.codeTheme");
    await writeFile(path.join(process.env.ALUNE_SMOKE_DIR, 'diff-theme-id'), themeId);
    for (const repo of repos) {
      await window.loadURL(origin + '/repositories/' + repo.id);
      await click('button[aria-label^="改动"]');
      await chooseFile('example.ts');
      await themeMatches(themeId, 'rgb(18, 35, 52)', 'rgb(255, 204, 119)');
      assert.equal(
        await execute(
          "getComputedStyle(document.querySelector('.diff-code-row--add, .diff-split-cell--add')).backgroundColor",
        ),
        'rgb(26, 58, 48)',
      );
    }
    await shot('desktop-imported');
  } catch (error) {
    console.error(await execute('({path:location.pathname,text:document.body.innerText})'));
    throw error;
  } finally {
    nativeTheme.themeSource = 'system';
  }
};
