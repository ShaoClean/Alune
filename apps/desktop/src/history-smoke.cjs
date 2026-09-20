const assert = require('node:assert/strict');

module.exports = async ({ window, origin, token, backend }) => {
  const { ConnectionService } = require('./server/connection/connection.service');
  const { GitCommands, GitLogChangedError } = require('@remote-git/ssh-client');
  const connections = backend.get(ConnectionService);
  const originalConnect = connections.ensureConnected;
  const originals = Object.fromEntries(
    ['status', 'log', 'commitFiles', 'diff'].map((key) => [key, GitCommands.prototype[key]]),
  );
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const create = async (resource, body) => {
    const response = await fetch(origin + '/api/' + resource, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(response.ok, true);
    return response.json();
  };
  const execute = (script) => window.webContents.executeJavaScript(script);
  const wait = (expression) =>
    execute(
      'new Promise((resolve, reject) => { const start = Date.now(); const check = () => { if (' +
        expression +
        ') return resolve(true); if (Date.now() - start > 10000) return reject(new Error("History smoke timed out")); setTimeout(check, 30); }; check(); })',
    );
  const click = (selector) =>
    execute('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const hash = (index) => index.toString(16).padStart(40, '0');
  let revision = 'first';
  let commits = Array.from({ length: 155 }, (_, index) => ({
    hash: hash(index + 1),
    shortHash: hash(index + 1).slice(-7),
    message: 'history smoke ' + index,
    author: 'Fixture',
    email: 'fixture@example.invalid',
    date: '2026-09-16T08:00:00Z',
    refs: [],
    parents:
      index === 154
        ? []
        : index === 0
          ? [hash(2), hash(3)]
          : index === 1
            ? [hash(4)]
            : [hash(index + 2)],
    references:
      index === 2
        ? [{ name: 'upstream/topic', fullName: 'refs/remotes/upstream/topic', kind: 'remote' }]
        : [],
  }));
  let connection, repo;
  const originalSize = window.getSize();
  try {
    connections.ensureConnected = async () => ({});
    GitCommands.prototype.status = async () => ({ branch: 'main', ahead: 0, behind: 0, files: [] });
    GitCommands.prototype.log = async (_path, options) => {
      if (options.revision && options.revision !== revision) throw new GitLogChangedError();
      const offset = Number(options.skip || 0),
        count = Number(options.count || 50);
      return {
        commits: commits.slice(offset, offset + count),
        hasMore: offset + count < commits.length,
        nextSkip: Math.min(commits.length, offset + count),
        revision,
        shallow: false,
      };
    };
    GitCommands.prototype.commitFiles = async () => [
      { path: 'graph.ts', status: 'added', additions: 1, deletions: 0 },
    ];
    GitCommands.prototype.diff = async () =>
      'diff --git a/graph.ts b/graph.ts\nnew file mode 100644\n--- /dev/null\n+++ b/graph.ts\n@@ -0,0 +1 @@\n+export const graph = true;\n';
    connection = await create('connections', {
      name: 'History fixture',
      host: 'fixture.invalid',
      port: 22,
      username: 'fixture',
      authType: 'password',
      password: 'test-only',
    });
    repo = await create('repositories', { connectionId: connection.id, path: '/fixture/history' });
    await window.loadURL(origin + '/repositories/' + repo.id);
    await wait("document.querySelector('.workspace-panel-tabs')");
    await execute(
      "Array.from(document.querySelectorAll('.workspace-panel-tabs > button')).find(button => button.textContent === '提交历史').click()",
    );
    await wait("document.querySelectorAll('.history-row').length > 0");
    assert.equal(
      await execute('document.querySelector(\'[aria-label="显示右侧面板"]\').disabled'),
      true,
    );
    await click('.history-row');
    await wait(
      "document.querySelector('.history-detail .diff-code-row--add')?.textContent.includes('graph = true')",
    );
    const split = await execute(
      "Number(document.querySelector('.history-resize').getAttribute('aria-valuenow'))",
    );
    await execute(
      "document.querySelector('.history-resize').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))",
    );
    assert.ok(
      (await execute(
        "Number(document.querySelector('.history-resize').getAttribute('aria-valuenow'))",
      )) < split,
    );
    await click('[aria-label="查看提交文件 graph.ts"]');
    await wait(
      "document.querySelector('.history-detail .diff-shell__title')?.textContent.includes('graph.ts')",
    );
    for (const count of [100, 150, 155]) {
      await execute(
        "(() => { const el = document.querySelector('.history-viewport'); el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll', { bubbles: true })); })()",
      );
      await wait(
        "Number(document.querySelector('.history-table').getAttribute('aria-rowcount')) === " +
          (count + 1),
      );
      assert.equal(await execute("document.querySelector('.history-detail') !== null"), true);
    }
    assert.ok((await execute("document.querySelectorAll('.history-row').length")) < 100);
    await click('[aria-label="更多仓库视图"]');
    await execute(
      "Array.from(document.querySelectorAll('.ant-dropdown-menu-item')).find(item => item.textContent.includes('刷新仓库')).click()",
    );
    await wait(
      "Number(document.querySelector('.history-table').getAttribute('aria-rowcount')) === 51",
    );
    assert.equal(await execute("document.querySelector('.history-detail') !== null"), true);
    revision = 'second';
    await execute(
      "(() => { const el = document.querySelector('.history-viewport'); el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll', { bubbles: true })); })()",
    );
    await wait(
      "document.querySelector('.history-notice--error')?.textContent.includes('历史已变化')",
    );
    assert.equal(await execute("document.querySelectorAll('.history-row--selected').length"), 1);
    await click('.history-notice--error button');
    await wait("!document.querySelector('.history-notice--error')");
    await execute(
      "(() => { const viewport = document.querySelector('.history-viewport'); viewport.scrollTop = 180; viewport.dispatchEvent(new Event('scroll', { bubbles: true })); })()",
    );
    await wait("document.querySelector('.history-viewport').scrollTop === 180");
    window.setSize(600, 760);
    await wait("document.querySelector('.history-workspace--compact')");
    await execute(
      "Array.from(document.querySelectorAll('.history-detail__header button')).find(button => button.textContent === '返回列表').click()",
    );
    await wait("!document.querySelector('.history-detail')");
    const restoredScroll = await execute("document.querySelector('.history-viewport').scrollTop");
    assert.ok(restoredScroll === 0 || restoredScroll === 180);
    await execute("document.querySelector('.history-viewport').scrollTop = 180");
    await wait("document.querySelector('.history-viewport').scrollTop === 180");
    await click('.history-row');
    await wait("document.querySelector('.history-detail .diff-code-row--add')");
    assert.equal(
      await execute("document.querySelector('.history-workspace__graph').getClientRects().length"),
      0,
    );
    window.setSize(...originalSize);
    await wait("!document.querySelector('.history-workspace--compact')");
    commits = commits.slice(1);
    revision = 'third';
    await click('[aria-label="更多仓库视图"]');
    await execute(
      "Array.from(document.querySelectorAll('.ant-dropdown-menu-item')).find(item => item.textContent.includes('刷新仓库')).click()",
    );
    await wait("!document.querySelector('.history-detail')");
    console.log(
      'Desktop history passed: graph selection, file Diff, 155 commits, virtual rows, scroll retention, refresh conflicts and compact return.',
    );
  } finally {
    window.setSize(...originalSize);
    connections.ensureConnected = originalConnect;
    Object.assign(GitCommands.prototype, originals);
    if (repo) await fetch(origin + '/api/repositories/' + repo.id, { method: 'DELETE', headers });
    if (connection)
      await fetch(origin + '/api/connections/' + connection.id, { method: 'DELETE', headers });
  }
};
