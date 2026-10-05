const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { startCreationFixture } = require('./pull-request-creation-fixture.cjs');

test('creation HTTP flow uses real local/SSH branches, scopes AI, and creates ordinary/draft GitHub and self-hosted GitLab requests', async () => {
  const f = await startCreationFixture();
  const query = {
    remote: 'origin',
    target: 'https://github.com/fixture/alune',
    provider: 'github',
    token: 'fixture-hosting-secret',
  };
  const post = async (repo, endpoint, body) => {
    const res = await fetch(`${f.url}/api/repositories/${repo}/pull-requests/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return { status: res.status, data: await res.json() };
  };
  const form = (preview) => ({
    ...query,
    sourceBranch: preview.sourceBranch,
    targetBranch: preview.targetBranch,
    revision: preview.revision,
    operationId: randomUUID(),
    title: 'feat: 创建 PR/MR',
    description: '已检查改动',
    draft: false,
  });
  try {
    const before = f.fixture.git('status', '--porcelain');
    const ssh = await post(f.main.id, 'preview', query);
    assert.equal(ssh.status, 200, JSON.stringify(ssh.data));
    const local = await post(f.local.id, 'preview', query);
    assert.equal(local.status, 200, JSON.stringify(local.data));
    assert.equal(local.data.revision, ssh.data.revision);
    assert.equal(ssh.data.sourceBranch, 'feature/create-pr');
    assert.equal(ssh.data.targetBranch, 'main');
    assert.equal(ssh.data.files[0].path, 'entry.ts');
    assert.match(ssh.data.template, /## 验证/);
    f.creation.published = false;
    assert.equal((await post(f.main.id, 'preview', query)).data.pushRequired, true);
    assert.equal((await post(f.main.id, 'create', form(ssh.data))).status, 409);
    f.creation.published = true;
    f.creation.base = 'c'.repeat(40);
    assert.equal((await post(f.main.id, 'create', form(ssh.data))).status, 409);
    f.creation.base = f.fixture.git('rev-parse', 'main').trim();
    const settings = await (await fetch(`${f.url}/api/ai/settings`)).json();
    const generate = () =>
      fetch(`${f.url}/api/ai/repositories/${f.main.id}/pull-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...query,
          revision: ssh.data.revision,
          configRevision: settings.revision,
        }),
      });
    const generated = await generate();
    assert.equal(generated.status, 201, await generated.clone().text());
    assert.match((await generated.json()).description, /## 验证/);
    assert.doesNotMatch(
      JSON.stringify(f.creation.ai),
      /UNCOMMITTED_PRIVATE_CONTENT|private.txt|fixture-hosting-secret/,
    );
    assert.equal(f.creation.created.length, 0, 'AI drafting never publishes');
    f.creation.huge = true;
    const large = await post(f.local.id, 'preview', query);
    assert.equal(large.status, 200, JSON.stringify(large.data));
    assert.match(large.data.notice, /不完整|省略/);
    assert.ok(
      large.data.files.reduce((length, file) => length + (file.patch?.length || 0), 0) <= 200000,
    );
    const largeDraft = await generate();
    assert.equal(largeDraft.status, 201, await largeDraft.clone().text());
    assert.equal((await largeDraft.json()).truncated, true);
    const aiContent = f.creation.ai.at(-1).messages.at(-1).content;
    assert.ok(aiContent.length <= 60000);
    f.creation.huge = false;
    for (const provider of ['github', 'gitlab']) {
      for (const draft of [false, true]) {
        f.creation.created.length = 0;
        const selected =
          provider === 'github'
            ? query
            : {
                ...query,
                provider,
                remote: 'upstream',
                target: 'https://gitlab.example.com/team/sub/alune',
              };
        const preview = await post(f.main.id, 'preview', selected);
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        const body = { ...form(preview.data), ...selected, draft };
        f.creation.writeStatus = 403;
        const denied = await post(f.main.id, 'create', body);
        assert.equal(denied.status, 403);
        assert.match(denied.data.message, /写入权限/);
        f.creation.writeStatus = 200;
        const [created, retry] = await Promise.all([
          post(f.main.id, 'create', body),
          post(f.main.id, 'create', body),
        ]);
        assert.equal(created.status, 200, JSON.stringify(created.data));
        assert.deepEqual(created.data, retry.data);
        assert.equal(f.creation.created.length, 1);
        assert.equal(created.data.item.draft, draft);
        const detail = await post(f.main.id, 'detail', {
          ...selected,
          number: created.data.item.number,
        });
        assert.equal(detail.status, 200);
        assert.equal(detail.data.title, created.data.item.title);
        assert.equal(
          (await post(f.main.id, 'preview', selected)).data.existing.number,
          created.data.item.number,
        );
        assert.equal(
          (await post(f.main.id, 'create', { ...body, operationId: randomUUID() })).status,
          409,
        );
      }
    }
    f.creation.template = false;
    assert.equal((await post(f.local.id, 'preview', query)).data.template, '');
    const noTemplate = await generate();
    assert.equal(noTemplate.status, 201, await noTemplate.clone().text());
    assert.equal(JSON.parse(f.creation.ai.at(-1).messages.at(-1).content).template, '');
    assert.equal(f.fixture.git('status', '--porcelain'), before);
  } finally {
    await f.close();
  }
});
