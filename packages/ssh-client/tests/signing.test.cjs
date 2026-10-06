const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createRepository } = require('./helpers/local-repository.cjs');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
const {
  GitSigning,
  GitCommands,
  GitTags,
  LocalConnection,
  SSHConnection,
  signatureStatus,
  signingFailure,
} = require('../dist');
process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

async function setup(t, kind) {
  const f = createRepository();
  let transport = new LocalConnection();
  let remote;
  const cleanup = [];
  t.after(async () => {
    for (const clean of cleanup) await clean();
    if (remote) {
      transport.disconnect();
      await remote.close();
    }
    f.close();
  });
  if (kind === 'ssh') {
    remote = await startSSHServer();
    transport = new SSHConnection(remote.options);
    transport.on('error', () => {});
    await transport.connect();
  }
  return {
    ...f,
    cleanup,
    signing: new GitSigning(transport),
    commands: new GitCommands(transport),
    tags: new GitTags(transport),
  };
}
function sshKey(f) {
  const key = join(f.root, 'signing key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  const allowed = join(f.root, 'allowed signers');
  fs.writeFileSync(allowed, 'fixture@example.invalid ' + fs.readFileSync(key + '.pub', 'utf8'));
  f.git('config', 'gpg.ssh.allowedSignersFile', allowed);
  return { key, allowed };
}
async function commit(f, message, amend) {
  const result = await f.commands.commit(f.repo, message, amend);
  assert.equal(result.exitCode, 0, result.stderr);
  return f.git('rev-parse', 'HEAD').trim();
}
for (const kind of ['local', 'ssh']) {
  test(
    `${kind}: SSH signed commit/amend/tag, trust changes, tampering and failure integrity`,
    { skip: kind === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const f = await setup(t, kind);
      const { key, allowed } = sshKey(f);
      const unsigned = f.git('rev-parse', 'HEAD').trim();
      assert.equal((await f.signing.read(f.repo)).enabled, false);
      await f.signing.save(f.repo, { enabled: true, format: 'ssh', signingKey: key });
      assert.deepEqual(await f.signing.read(f.repo), {
        enabled: true,
        format: 'ssh',
        signingKey: key,
        tagEnabled: false,
      });
      f.write('tracked.txt', 'signed\n');
      await f.commands.stage(f.repo, ['tracked.txt']);
      const signed = await commit(f, 'signed');
      assert.equal(f.git('log', '-1', '--format=%G?').trim(), 'G');
      assert.match(f.git('log', '-1', '--show-signature', '--format=%s'), /Good "git" signature/);
      let statuses = await f.signing.signatures(f.repo, [signed, unsigned]);
      assert.deepEqual(
        statuses.map((s) => s.status),
        ['valid', 'unsigned'],
      );
      assert.ok(statuses[0].key);
      assert.equal(statuses[0].signer, 'fixture@example.invalid');
      const amended = await commit(f, 'amended', signed);
      assert.notEqual(amended, signed);
      assert.equal(f.git('log', '-1', '--format=%G?').trim(), 'G');
      assert.equal(f.git('rev-parse', 'HEAD^').trim(), unsigned);
      await assert.rejects(f.commands.commit(f.repo, 'stale', signed), /已变化/);
      await f.tags.create(f.repo, { name: 'signed-tag', type: 'annotated', message: 'release' });
      f.git('verify-tag', 'signed-tag');
      assert.equal(
        (await f.tags.list(f.repo)).find((tag) => tag.name === 'signed-tag').message,
        'release',
      );
      await f.tags.create(f.repo, { name: 'light', type: 'lightweight' });
      assert.equal(f.git('cat-file', '-t', 'light').trim(), 'commit');
      const object = f.git('cat-file', 'commit', amended).replace(/amended\n$/, 'tampered\n');
      const tampered = execFileSync(
        'git',
        ['-C', f.repo, 'hash-object', '-t', 'commit', '-w', '--stdin'],
        { input: object, encoding: 'utf8' },
      ).trim();
      assert.equal((await f.signing.signatures(f.repo, [tampered]))[0].status, 'invalid');
      fs.writeFileSync(allowed, '');
      statuses = await f.signing.signatures(f.repo, [amended]);
      assert.equal(statuses[0].status, 'unknown');
      assert.equal(statuses[0].code, f.git('log', '-1', '--format=%G?').trim());
      f.git('config', '--unset', 'gpg.ssh.allowedSignersFile');
      assert.equal((await f.signing.signatures(f.repo, [amended]))[0].status, 'unknown');
      await f.signing.save(f.repo, {
        enabled: true,
        format: 'ssh',
        signingKey: join(f.root, 'missing'),
      });
      f.write('tracked.txt', 'must remain staged\n');
      await f.commands.stage(f.repo, ['tracked.txt']);
      const index = f.git('write-tree');
      for (const amend of [undefined, amended]) {
        const failed = await f.commands.commit(f.repo, 'must fail', amend);
        assert.notEqual(failed.exitCode, 0);
        assert.match(failed.stderr, /签名失败.*密钥/s);
        assert.equal(f.git('rev-parse', 'HEAD').trim(), amended);
        assert.equal(f.git('write-tree'), index);
      }
      await assert.rejects(
        f.tags.create(f.repo, { name: 'failed-tag', type: 'annotated', message: 'failure' }),
        /签名失败/,
      );
      assert.equal(f.git('tag', '--list', 'failed-tag').trim(), '');
      const socket = process.env.SSH_AUTH_SOCK;
      try {
        process.env.SSH_AUTH_SOCK = join(f.root, 'missing-agent.sock');
        await f.signing.save(f.repo, {
          enabled: true,
          format: 'ssh',
          signingKey: 'key::' + fs.readFileSync(key + '.pub', 'utf8').trim(),
        });
        const failed = await f.commands.commit(f.repo, 'missing agent', amended);
        assert.notEqual(failed.exitCode, 0);
        assert.match(failed.stderr, /签名失败/);
        assert.equal(f.git('rev-parse', 'HEAD').trim(), amended);
        assert.equal(f.git('write-tree'), index);
      } finally {
        if (socket === undefined) delete process.env.SSH_AUTH_SOCK;
        else process.env.SSH_AUTH_SOCK = socket;
      }
      await f.signing.save(f.repo, { enabled: false, format: 'ssh', signingKey: key });
      const disabled = await commit(f, 'disabled');
      assert.equal((await f.signing.signatures(f.repo, [disabled]))[0].status, 'unsigned');
      f.git('config', 'tag.gpgsign', 'true');
      await f.tags.create(f.repo, {
        name: 'tag-only-signing',
        type: 'annotated',
        message: 'signed despite commit switch',
      });
      assert.match(f.git('cat-file', '-p', 'tag-only-signing'), /BEGIN SSH SIGNATURE/);
    },
  );

  test(
    `${kind}: real GPG signing, amend and tags`,
    {
      skip:
        spawnSync('gpg', ['--version']).status !== 0 ||
        (kind === 'ssh' && process.platform === 'win32'),
    },
    async (t) => {
      const f = await setup(t, kind);
      const directory = join(f.root, 'gnupg');
      fs.mkdirSync(directory, { mode: 0o700 });
      // MSYS GPG treats even C:/... as relative; native Windows GPG needs a drive path.
      const msys =
        process.platform === 'win32' &&
        execFileSync('gpgconf', ['--list-dirs', 'homedir'], { encoding: 'utf8' })
          .trim()
          .startsWith('/');
      const home = msys
        ? execFileSync('cygpath', ['-u', directory], { encoding: 'utf8' }).trim()
        : directory;
      const previous = process.env.GNUPGHOME;
      process.env.GNUPGHOME = home;
      f.cleanup.push(() => {
        spawnSync('gpgconf', ['--homedir', home, '--kill', 'gpg-agent']);
        if (previous === undefined) delete process.env.GNUPGHOME;
        else process.env.GNUPGHOME = previous;
      });
      execFileSync('gpg', [
        '--batch',
        '--pinentry-mode',
        'loopback',
        '--passphrase',
        '',
        '--quick-generate-key',
        'Fixture <fixture@example.invalid>',
        'ed25519',
        'sign',
        '0',
      ]);
      await f.signing.save(f.repo, {
        enabled: true,
        format: 'openpgp',
        signingKey: 'fixture@example.invalid',
      });
      f.write('tracked.txt', 'gpg signed');
      await f.commands.stage(f.repo, ['tracked.txt']);
      const signed = await commit(f, 'gpg');
      assert.equal((await f.signing.signatures(f.repo, [signed]))[0].status, 'valid');
      const amended = await commit(f, 'gpg amended', signed);
      // The fixture's git helper captures env before GNUPGHOME is set.
      const verify = (...args) =>
        execFileSync('git', ['-C', f.repo, ...args], {
          env: { ...process.env, GNUPGHOME: home },
          encoding: 'utf8',
        });
      verify('verify-commit', amended);
      await f.tags.create(f.repo, { name: 'gpg-tag', type: 'annotated', message: 'signed' });
      verify('verify-tag', 'gpg-tag');
      await f.signing.save(f.repo, {
        enabled: true,
        format: 'openpgp',
        signingKey: 'unavailable@example.invalid',
      });
      const failure = await f.commands.commit(f.repo, 'failed', amended);
      assert.notEqual(failure.exitCode, 0);
      assert.match(failure.stderr, /签名失败/);
      assert.equal(f.git('rev-parse', 'HEAD').trim(), amended);
    },
  );
}

test('validate inputs before executing Git and retain all Git verification states', async () => {
  const signing = new GitSigning({
    execGit() {
      throw new Error('must not execute');
    },
  });
  for (const hashes of [[], ['HEAD'], ['--all'], Array(101).fill('a'.repeat(40)), null])
    await assert.rejects(signing.signatures('/repo', hashes), /哈希/);
  for (const config of [
    null,
    { enabled: 'true', format: 'ssh', signingKey: 'x' },
    { enabled: true, format: 'x509', signingKey: 'x' },
    { enabled: true, format: 'ssh', signingKey: 'x\n' },
  ])
    await assert.rejects(signing.save('/repo', config), /有效/);
  assert.deepEqual(['G', 'B', 'U', 'X', 'Y', 'R', 'E', 'N', '?'].map(signatureStatus), [
    'valid',
    'invalid',
    'unknown',
    'invalid',
    'invalid',
    'invalid',
    'unknown',
    'unsigned',
    'unknown',
  ]);
  assert.match(
    signingFailure('gpg: signing failed: Inappropriate ioctl for device'),
    /pinentry.*终端/,
  );
  assert.match(signingFailure('signing failed: agent refused operation'), /agent/);
  assert.equal(signingFailure('nothing to commit'), 'nothing to commit');
});

test('empty signing key removes only the local override, malformed config is reported', async (t) => {
  const f = await setup(t, 'local');
  await f.signing.save(f.repo, { enabled: false, format: 'openpgp', signingKey: '' });
  assert.equal((await f.signing.read(f.repo)).signingKey, '');
  f.git('config', 'commit.gpgsign', 'not-a-boolean');
  await assert.rejects(f.signing.read(f.repo), /无法读取签名配置/);
});

test('invalid signing config waits for every in-flight Git read before rejecting', async () => {
  const pending = [];
  const signing = new GitSigning({
    execGit(_path, args) {
      if (args.at(-1) === 'commit.gpgsign')
        return Promise.resolve({ exitCode: 128, stdout: '', stderr: 'bad boolean' });
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  let settled = false;
  const reading = signing.read('/repo');
  reading.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const settledBeforeOtherReads = settled;
  for (const resolve of pending) resolve({ exitCode: 1, stdout: '', stderr: '' });
  await assert.rejects(reading, /无法读取签名配置.*bad boolean/);
  assert.equal(pending.length, 3);
  assert.equal(settledBeforeOtherReads, false);
});

test(
  'headless GPG pinentry failure gives advice and preserves HEAD/index',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = await setup(t, 'local');
    const program = join(f.root, 'gpg-fixture');
    fs.writeFileSync(
      program,
      '#!/bin/sh\necho "gpg: signing failed: Inappropriate ioctl for device (pinentry)" >&2\nexit 1\n',
      { mode: 0o700 },
    );
    f.git('config', 'gpg.program', program);
    await f.signing.save(f.repo, { enabled: true, format: 'openpgp', signingKey: 'fixture' });
    f.write('tracked.txt', 'waiting for pinentry\n');
    await f.commands.stage(f.repo, ['tracked.txt']);
    const head = f.git('rev-parse', 'HEAD');
    const index = f.git('write-tree');
    const result = await f.commands.commit(f.repo, 'pinentry fails');
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /pinentry.*终端/s);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
    assert.equal(f.git('write-tree'), index);
  },
);
