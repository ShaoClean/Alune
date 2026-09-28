const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async ({ backend, origin, token, restore = false }) => {
  const { AccessTokensService } = require('./server/access-tokens/access-tokens.service');
  const { PullRequestsService } = require('./server/repository/pull-requests.service');
  const store = backend.get(AccessTokensService);
  const pulls = backend.get(PullRequestsService);
  const marker = join(process.env.ALUNE_DATA_DIR, 'access-tokens-smoke.json');
  const value = 'isolated-desktop-access-token';
  const call = async (path, method, body, status = 200) => {
    const response = await fetch(`${origin}/api/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, status);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    assert.equal(JSON.stringify(data).includes(value), false);
    return data;
  };
  if (restore) {
    const saved = JSON.parse(readFileSync(marker, 'utf8'));
    if (!saved.available) {
      assert.equal(store.list().tokens.length, 0);
      return;
    }
    const remotes = await pulls.remotes(saved.repositoryId);
    assert.equal(remotes[0].selection.tokenId, saved.id);
    assert.equal(store.credential(saved.repositoryId, remotes[0], 'github').token, value);
    await call(`access-tokens/${saved.id}`, 'DELETE', { revision: store.list().revision });
    assert.equal((await pulls.remotes(saved.repositoryId))[0].selection.status, 'token-deleted');
    assert.equal(
      backend.get('DATABASE').prepare('SELECT * FROM access_token_secrets').all().length,
      0,
    );
    await call(`repositories/${saved.repositoryId}`, 'DELETE');
    console.log(
      'Desktop named tokens: OS-protected credential and repository choice restored after process restart; deletion cleared secrets and references.',
    );
    return;
  }
  const initial = await call('access-tokens', 'GET');
  if (!initial.secretStorage.available) {
    await call(
      'access-tokens',
      'POST',
      { name: 'Desktop token', value, revision: initial.revision },
      503,
    );
    assert.equal(store.list().tokens.length, 0);
    writeFileSync(marker, JSON.stringify({ available: false }));
    console.log(
      'Desktop named tokens: unavailable OS storage rejected saving without plaintext fallback.',
    );
    return;
  }
  const saved = await call(
    'access-tokens',
    'POST',
    { name: 'Desktop token', value, revision: initial.revision },
    201,
  );
  const id = saved.tokens[0].id;
  const path = join(process.env.ALUNE_DATA_DIR, 'token-repository');
  mkdirSync(path);
  execFileSync('git', ['init', '-q', path]);
  execFileSync('git', [
    '-C',
    path,
    'remote',
    'add',
    'origin',
    'https://github.com/fixture/tokens.git',
  ]);
  const repo = await call('repositories', 'POST', { source: 'local', path }, 201);
  await call(`repositories/${repo.id}/pull-requests/token`, 'POST', {
    remote: 'origin',
    target: 'https://github.com/fixture/tokens',
    provider: 'github',
    tokenId: id,
    revision: saved.revision,
  });
  const encrypted = backend
    .get('DATABASE')
    .prepare('SELECT ciphertext FROM access_token_secrets WHERE token_id = ?')
    .get(id).ciphertext;
  assert.ok(encrypted.startsWith('safe-storage:'));
  assert.equal(encrypted.includes(value), false);
  writeFileSync(marker, JSON.stringify({ available: true, id, repositoryId: repo.id }));
  console.log('Desktop named tokens: encrypted persistence and actual Git remote binding passed.');
};
