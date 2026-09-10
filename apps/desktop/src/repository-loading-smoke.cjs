const assert = require('node:assert/strict');

module.exports = async ({ window, origin, token, backend }) => {
  const { ConnectionService } = require('./server/connection/connection.service');
  const { GitCommands } = require('@remote-git/ssh-client');
  const connections = backend.get(ConnectionService);
  const originalConnect = connections.ensureConnected;
  const originalStatus = GitCommands.prototype.status;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const create = async (resource, body) =>
    (
      await fetch(`${origin}/api/${resource}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    ).json();
  const execute = (script) => window.webContents.executeJavaScript(script);
  const waitFor = (expression) =>
    execute(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (${expression}) return resolve(true);
      if (Date.now() - started > 15000) return reject(new Error('Repository loading smoke timed out'));
      setTimeout(check, 30);
    }; check();
  })`);
  let connection, repo;
  try {
    connections.ensureConnected = async () => {
      throw new Error('模拟远程主机离线');
    };
    connection = await create('connections', {
      name: 'Async status fixture',
      host: 'fixture.invalid',
      port: 22,
      username: 'fixture',
      authType: 'password',
      password: 'test-only',
    });
    repo = await create('repositories', {
      connectionId: connection.id,
      path: '/fixture/async-status',
    });
    // Reloading starts the renderer with an empty store and a populated isolated DB.
    const started = performance.now();
    await window.loadURL(`${origin}/repositories`);
    await waitFor("document.querySelector('.repository-card')?.innerText.includes('async-status')");
    const visibleMs = performance.now() - started;
    await waitFor("document.querySelector('.repository-card')?.innerText.includes('状态失败')");
    assert.equal(await execute("document.body.innerText.includes('暂无已登记的仓库')"), false);
    assert.equal(
      await execute("document.querySelector('.repository-card').innerText.includes('分支未知')"),
      true,
    );
    connections.ensureConnected = async () => ({});
    GitCommands.prototype.status = async () => ({
      branch: 'recovered',
      files: [],
      ahead: 0,
      behind: 0,
    });
    await execute('document.querySelector(\'[aria-label="刷新 async-status 状态"]\').click()');
    await waitFor("document.querySelector('.repository-card')?.innerText.includes('recovered')");
    assert.equal(
      await execute("document.querySelector('.repository-card').innerText.includes('干净')"),
      true,
    );
    // Fail again: retain the branch, timestamp and registration while showing old data.
    connections.ensureConnected = async () => {
      throw new Error('模拟再次离线');
    };
    await execute('document.querySelector(\'[aria-label="刷新 async-status 状态"]\').click()');
    await waitFor(
      "document.querySelector('.repository-card')?.innerText.includes('更新失败 · 旧状态')",
    );
    assert.equal(
      await execute("document.querySelector('.repository-card').innerText.includes('recovered')"),
      true,
    );
    console.log(
      `Desktop repository cold load and retry passed: list visible in ${visibleMs.toFixed(1)} ms with SSH disabled; recovery and stale cache verified.`,
    );
  } finally {
    connections.ensureConnected = originalConnect;
    GitCommands.prototype.status = originalStatus;
    if (repo?.id)
      await fetch(`${origin}/api/repositories/${repo.id}`, { method: 'DELETE', headers });
    if (connection?.id)
      await fetch(`${origin}/api/connections/${connection.id}`, { method: 'DELETE', headers });
  }
};
