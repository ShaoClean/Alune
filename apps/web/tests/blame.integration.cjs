const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBlameFixture } = require('./blame-fixture.cjs');

test('production HTTP exposes matching local, SSH and Worktree blame with commit navigation', async () => {
  const fixture = await createBlameFixture();
  const get = async (id, endpoint, params) => {
    const response = await fetch(
      `${fixture.url}/api/repositories/${id}/${endpoint}?${new URLSearchParams(params)}`,
    );
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const repo of [fixture.local, fixture.ssh, fixture.worktree]) {
      const result = await get(repo.id, 'blame', { path: fixture.file });
      assert.equal(result.status, 200);
      assert.equal(result.body.kind, 'ready');
      assert.equal(result.body.lines[1].hash, fixture.edited);
      assert.equal(result.body.lines[5].hash, fixture.first);
      assert.equal(result.body.ignoreRevsApplied, true);
      const parent = await get(repo.id, 'blame', {
        path: fixture.file,
        previousLine: '2',
        expectedVersion: result.body.version,
      });
      assert.equal(parent.body.revision, fixture.first);
      assert.equal(parent.body.path, '原文件.ts');
      assert.equal(parent.body.focusLine, 2);
      const detail = await get(repo.id, 'blame-commit', { commit: fixture.first });
      assert.equal(detail.body.hash, fixture.first);
      assert.match(detail.body.body, /完整提交说明/);
      const history = await get(repo.id, 'log', { count: '50' });
      assert.ok(!history.body.commits.some((commit) => commit.hash === fixture.first));
      const focused = await get(repo.id, 'log', { count: '50', branch: fixture.first });
      assert.equal(focused.body.commits[0].hash, fixture.first);
    }
    const id = fixture.local.id;
    const stale = await get(id, 'blame', {
      path: fixture.file,
      previousLine: '2',
      expectedVersion: 'f'.repeat(64),
    });
    assert.equal(stale.status, 400);
    assert.match(stale.body.message, /追溯已变化/);
    for (const params of [
      { path: '../escape' },
      { path: fixture.file, revision: '--help' },
      { path: fixture.file, ignoreWhitespace: 'yes' },
      { path: fixture.file, previousLine: '0' },
    ]) {
      assert.equal((await get(id, 'blame', params)).status, 400);
    }
    assert.equal((await get(id, 'blame', { path: 'missing.txt' })).status, 404);
    for (const path of ['二进制.dat', '大文件.txt'])
      assert.equal((await get(id, 'blame', { path })).body.kind, 'unavailable');
    const newFile = await get(id, 'blame', { path: '新文件.txt' });
    assert.equal(newFile.body.lines[0].uncommitted, true);
    const unignored = await get(id, 'blame', { path: fixture.file, useIgnoreRevs: 'false' });
    assert.equal(unignored.body.lines[5].hash, fixture.format);
  } finally {
    await fixture.close();
  }
});
