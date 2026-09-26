const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');

// Actual Electron/backend/Git integration. Native dialog result is stubbed so CI
// never opens an unattended OS picker; it still crosses the trusted preload IPC.
module.exports = async ({ window, origin, token }) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alune-native-local-'));
  const repo = path.join(root, "local ' 仓库");
  mkdirSync(repo);
  const config = path.join(root, 'empty.gitconfig');
  writeFileSync(config, '');
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' },
    });
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgSign', 'false');
  writeFileSync(path.join(repo, 'first.txt'), 'first local file\n');
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = async (route, body, method) => {
    const response = await fetch(origin + '/api' + route, {
      method: method || (body ? 'POST' : 'GET'),
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    assert.ok(response.ok, `${method || 'request'} ${route}: ${response.status} ${text}`);
    return text ? JSON.parse(text) : undefined;
  };
  let registered;
  const { dialog } = require('electron');
  const originalPicker = dialog.showOpenDialog;
  try {
    const inspection = await api('/repositories/local/inspect', { path: repo });
    assert.equal(inspection.unborn, true);
    assert.equal(inspection.source, 'local');
    registered = await api('/repositories', { source: 'local', path: repo });
    await window.loadURL(origin + '/repositories/' + registered.id);
    const wait = (expression) =>
      window.webContents.executeJavaScript(
        `new Promise((resolve, reject) => { const start = Date.now(); const check = () => { if (${expression}) return resolve(true); if (Date.now() - start > 15000) return reject(new Error('local UI timeout: ' + document.body.innerText)); setTimeout(check, 30); }; check(); })`,
      );
    await wait(
      'document.body.textContent.includes("first.txt") && document.body.textContent.includes("本机执行")',
    );
    assert.equal(
      await window.webContents.executeJavaScript('typeof window.aluneWorkspace.chooseDirectory'),
      'function',
    );
    dialog.showOpenDialog = async (owner, options) => {
      assert.equal(owner, window);
      assert.deepEqual(options.properties, ['openDirectory']);
      return { canceled: false, filePaths: [repo] };
    };
    assert.equal(
      await window.webContents.executeJavaScript('window.aluneWorkspace.chooseDirectory()'),
      repo,
    );
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    assert.equal(
      await window.webContents.executeJavaScript('window.aluneWorkspace.chooseDirectory()'),
      null,
    );
    await api('/repositories/' + registered.id + '/author', {
      name: 'Desktop fixture',
      email: 'fixture@example.invalid',
    });
    await api('/repositories/' + registered.id + '/stage', { files: ['first.txt'] });
    await api('/repositories/' + registered.id + '/commit', { message: 'native local commit' });
    assert.equal(git('show', 'HEAD:first.txt'), 'first local file\n');
    assert.equal(readFileSync(path.join(repo, 'first.txt'), 'utf8'), 'first local file\n');
    await api('/repositories/' + registered.id + '/branch', {
      name: 'native-feature',
      checkout: true,
    });
    await window.webContents.executeJavaScript(
      'document.querySelector("button[aria-label=\\"刷新仓库\\"]").click()',
    );
    await wait(
      'document.querySelector(".branch-pill__name")?.textContent.includes("native-feature")',
    );
    assert.equal((await api('/repositories/' + registered.id + '/context')).source, 'local');
    console.log(
      'Desktop local Git passed: local source/path, real first commit, branch switch, preload directory selection and cancel (dialog stub).',
    );
  } finally {
    dialog.showOpenDialog = originalPicker;
    if (registered) await api('/repositories/' + registered.id, undefined, 'DELETE');
    await window.loadURL(origin + '/repositories');
    rmSync(root, { recursive: true, force: true });
  }
};
