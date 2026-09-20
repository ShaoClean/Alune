const assert = require('node:assert/strict');

// Renderer integration fixture. Real Git-over-SSH semantics are covered in ssh-client/tests.
module.exports = async ({ window, origin, token, backend }) => {
  const { ConnectionService } = require('./server/connection/connection.service');
  const { GitCommands } = require('@remote-git/ssh-client');
  const connections = backend.get(ConnectionService);
  const originalConnect = connections.ensureConnected;
  const originals = Object.fromEntries(
    ['status', 'diff', 'stage', 'unstage'].map((key) => [key, GitCommands.prototype[key]]),
  );
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const create = async (resource, body) => {
    const response = await fetch(`${origin}/api/${resource}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(response.ok, true);
    return response.json();
  };
  const execute = (script) => window.webContents.executeJavaScript(script);
  const waitFor = (expression) =>
    execute(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (${expression}) return resolve(true);
      if (Date.now() - started > 10000) return reject(new Error('Diff smoke timed out: ' + ${JSON.stringify(expression)}));
      setTimeout(check, 30);
    }; check();
  })`);
  const click = (selector) =>
    execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const preview = (file, staged = false) =>
    click(`button[aria-label="查看差异 ${file}（${staged ? '已暂存' : '未暂存'}）"]`);
  const file = '子目录/新增 文件.ts';
  let staged = false,
    edited = false;
  const patch = (text) =>
    `diff --git a/file b/file\nnew file mode 100644\n--- /dev/null\n+++ b/file\n@@ -0,0 +1 @@\n+${text}\n`;
  let connection, repo;
  try {
    connections.ensureConnected = async () => ({});
    GitCommands.prototype.status = async () => ({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [
        { path: file, staged, status: staged ? 'added' : 'untracked' },
        ...(staged && edited ? [{ path: file, staged: false, status: 'modified' }] : []),
        ...['empty.txt', 'binary.dat', 'large.txt', 'slow.txt'].map((path) => ({
          path,
          status: 'untracked',
          staged: false,
        })),
      ],
    });
    GitCommands.prototype.diff = async (_path, options) => {
      if (options.file === 'empty.txt')
        return 'diff --git a/empty b/empty\nnew file mode 100644\nindex 0000000..e69de29\n';
      if (options.file === 'binary.dat')
        return 'diff --git a/bin b/bin\nnew file mode 100644\nBinary files /dev/null and b/bin differ\n';
      if (options.file === 'large.txt') throw new Error('文件或差异超出预览限制（1 MiB）');
      if (options.file === 'slow.txt') {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return patch('stale response');
      }
      if (options.staged || !edited) return patch('desktop first');
      if (staged)
        return 'diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-desktop first\n+desktop second\n';
      return patch('desktop second');
    };
    GitCommands.prototype.stage = async () => {
      staged = true;
    };
    GitCommands.prototype.unstage = async () => {
      staged = false;
    };
    connection = await create('connections', {
      name: 'Diff preview fixture',
      host: 'fixture.invalid',
      port: 22,
      username: 'fixture',
      authType: 'password',
      password: 'test-only',
    });
    repo = await create('repositories', {
      connectionId: connection.id,
      path: '/fixture/new-file-diff',
    });
    await window.loadURL(`${origin}/repositories/${repo.id}`);
    await waitFor("document.querySelector('.file-row__select')");
    await preview(file);
    await waitFor(
      "document.querySelector('.diff-code-row--add')?.textContent.includes('desktop first')",
    );
    assert.equal(await execute("document.querySelectorAll('.diff-code-row--remove').length"), 0);
    await execute(
      "Array.from(document.querySelectorAll('.diff-view-switch .ant-segmented-item')).find(item => item.textContent.trim() === '分栏视图').click()",
    );
    await waitFor(
      "document.querySelector('.diff-split-cell--add')?.textContent.includes('desktop first')",
    );
    assert.equal(await execute("document.querySelectorAll('.diff-split-cell--remove').length"), 0);
    await click('[aria-label="专注阅读差异"]');
    await waitFor(
      "document.querySelector('.app-shell--collapsed') && document.querySelector('.workspace-body--right-hidden') && document.querySelector('.diff-split-cell--add')?.textContent.includes('desktop first')",
    );
    if (process.env.REMOTE_GIT_DIFF_SMOKE_SCREENSHOT) {
      require('node:fs').writeFileSync(
        process.env.REMOTE_GIT_DIFF_SMOKE_SCREENSHOT,
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    await click('[aria-label="显示左侧工作区"]');
    await click('[aria-label="显示右侧面板"]');
    await click(`button[aria-label="暂存 ${file}"]`);
    await waitFor("document.querySelector('.diff-shell__title')?.textContent.includes('已暂存')");
    edited = true;
    await click('[aria-label="刷新仓库"]');
    await waitFor(
      `document.querySelectorAll('.file-row__select[aria-label*="${file}"]').length === 2`,
    );
    assert.equal(
      await execute(
        "document.querySelector('.diff-shell__body').textContent.includes('desktop second')",
      ),
      false,
    );
    await preview(file);
    await waitFor(
      "document.querySelector('.diff-split-cell--add')?.textContent.includes('desktop second')",
    );
    assert.equal(
      await execute("document.querySelector('.diff-split-cell--remove code')?.textContent"),
      'desktop first',
    );
    await click(`button[aria-label="取消暂存 ${file}"]`);
    await waitFor(
      `document.querySelectorAll('.file-row__select[aria-label*="${file}"]').length === 1`,
    );
    await waitFor(
      "document.querySelector('.diff-split-cell--add')?.textContent.includes('desktop second') && !document.querySelector('.diff-split-cell--remove')",
    );
    for (const [name, feedback] of [
      ['empty.txt', '新增空文件'],
      ['binary.dat', '二进制文件'],
      ['large.txt', '1 MiB'],
    ]) {
      await preview(name);
      await waitFor(
        `document.querySelector('.diff-shell__body')?.textContent.includes(${JSON.stringify(feedback)})`,
      );
      assert.equal(
        await execute(
          "document.querySelector('.diff-shell__body').textContent.includes('请选择改动文件')",
        ),
        false,
      );
    }
    await preview('slow.txt');
    await preview('empty.txt');
    await waitFor(
      "document.querySelector('.diff-shell__body')?.textContent.includes('新增空文件')",
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(
      await execute(
        "document.querySelector('.diff-shell__body').textContent.includes('stale response')",
      ),
      false,
    );
    await click('[aria-label="关闭差异"]');
    await waitFor("!document.querySelector('.diff-shell')");
    console.log(
      'Desktop new-file diff passed: unified, split, focus, staging, editing, unstaging, feedback, late responses and closing.',
    );
  } finally {
    connections.ensureConnected = originalConnect;
    Object.assign(GitCommands.prototype, originals);
    if (repo?.id)
      await fetch(`${origin}/api/repositories/${repo.id}`, { method: 'DELETE', headers });
    if (connection?.id)
      await fetch(`${origin}/api/connections/${connection.id}`, { method: 'DELETE', headers });
  }
};
