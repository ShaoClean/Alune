const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('controlled signature command failure leaves real history and other repositories working, then retries with unchanged arguments', async t => {
  const { signatureFailureFixture } = await import('../scripts/signature-failure-fixture.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-signature-fixture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, ...signatureFailureFixture(directory), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  if (process.platform === 'win32') { assert.equal(env.ALUNE_TEST_SIGNATURE_SENTINEL, undefined); return; }
  const repos = ['first repo', "second '仓库"].map(name => path.join(directory, name));
  const git = (repo, ...args) => spawnSync('git', ['--literal-pathspecs', '-C', repo, ...args], { env, encoding: 'utf8' });
  for (const repo of repos) {
    fs.mkdirSync(repo);
    for (const args of [['init','-qb','main'],['config','user.name','fixture'],['config','user.email','fixture@example.invalid'],['config','commit.gpgsign','false'],['commit','--allow-empty','-qm','literal message $ untouched']]) assert.equal(git(repo,...args).status,0);
  }
  const signature = ['log','--no-walk','--format=%H%x00%G?%x00%GS%x00%GK','HEAD','--'];
  const before = git(repos[0], ...signature);
  assert.equal(before.status, 0);
  const marker = path.join(repos[0], '.git', env.ALUNE_TEST_SIGNATURE_SENTINEL);
  fs.writeFileSync(marker, 'fixture');
  assert.equal(git(repos[0], ...signature).status, 128);
  assert.match(git(repos[0], ...signature).stderr, /controlled-signature-command-failure/);
  assert.match(git(repos[0], 'log', '--format=%s').stdout, /^literal message \$ untouched/);
  assert.equal(git(repos[1], ...signature).status, 0);
  fs.unlinkSync(marker);
  assert.deepEqual(git(repos[0], ...signature).stdout, before.stdout);
  for (const repo of repos) assert.equal(git(repo, 'status', '--porcelain').stdout, '');
});
