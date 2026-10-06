const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSigningFixture } = require('./signing-fixture.cjs');

test('production HTTP: local and SSH signing configuration, commit, amend, tag and failed operations', async () => {
  const f = await createSigningFixture();
  const call = async (id, route, body) => {
    const response = await fetch(
      `${f.url}/api/repositories/${id}/${route}`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const repo of [f.local, f.ssh]) {
      let result = await call(repo.id, 'signing');
      assert.equal(result.status, 200);
      assert.equal(result.body.source, repo.source);
      assert.equal(result.body.format, 'ssh');
      result = await call(repo.id, 'signatures', { hashes: [f.signed, f.invalid] });
      assert.equal(result.status, 201);
      assert.deepEqual(
        result.body.map((v) => v.status),
        ['valid', 'invalid'],
      );
      for (const body of [
        {},
        { enabled: 'yes', format: 'ssh', signingKey: f.key },
        { enabled: true, format: 'ssh', signingKey: 'a\n' },
      ])
        assert.equal((await call(repo.id, 'signing', body)).status, 400);
      assert.equal((await call(repo.id, 'signatures', { hashes: ['--all'] })).status, 400);
      result = await call(repo.id, 'signing', { enabled: true, format: 'ssh', signingKey: f.key });
      assert.equal(result.status, 201);
      f.write('tracked.txt', `HTTP commit for ${repo.source}\n`);
      assert.equal((await call(repo.id, 'stage', { files: ['tracked.txt'] })).status, 201);
      result = await call(repo.id, 'commit', { message: 'HTTP signed' });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      let head = f.git('rev-parse', 'HEAD').trim();
      assert.equal(f.git('log', '-1', '--format=%G?').trim(), 'G');
      result = await call(repo.id, 'commit', { message: 'HTTP amended', amend: head });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      head = f.git('rev-parse', 'HEAD').trim();
      assert.equal(f.git('log', '-1', '--format=%G?').trim(), 'G');
      assert.equal(
        (await call(repo.id, 'commit', { message: 'stale', amend: f.signed })).status,
        400,
      );
      assert.equal(
        (
          await call(repo.id, 'tags', {
            name: `signed-${repo.source}`,
            type: 'annotated',
            message: 'release',
          })
        ).status,
        201,
      );
      f.git('verify-tag', `signed-${repo.source}`);
      await call(repo.id, 'signing', {
        enabled: true,
        format: 'ssh',
        signingKey: f.key + '.missing',
      });
      result = await call(repo.id, 'commit', { message: 'failure', amend: head });
      assert.equal(result.status, 400);
      assert.match(result.body.message, /签名失败.*密钥/s);
      assert.equal(f.git('rev-parse', 'HEAD').trim(), head);
      result = await call(repo.id, 'tags', {
        name: `failed-${repo.source}`,
        type: 'annotated',
        message: 'fail',
      });
      assert.equal(result.status, 400);
      assert.equal(f.git('tag', '--list', `failed-${repo.source}`).trim(), '');
      await call(repo.id, 'signing', { enabled: true, format: 'ssh', signingKey: f.key });
    }
  } finally {
    await f.close();
  }
});
