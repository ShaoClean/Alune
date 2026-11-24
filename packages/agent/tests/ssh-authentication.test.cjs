const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ProtocolError } = require('@alune/protocol');
const { connectHost, probeAuthentication } = require('../dist/adapters/ssh/connect');
const { forwardingSSH, httpProxy } = require('./helpers/proxy-fixture.cjs');

const direct = { revision: 'fixture', enabled: false, protocol: 'http', host: '', port: 0 };
const passwordProfile = {
  authType: 'password',
  host: 'ssh.fixture.invalid',
  port: 22,
  username: 'fixture',
  password: 'fixture-ssh-secret',
};
const wrongHostKey = '0'.repeat(64);

test(
  'SSH reconnect and proxy test preserve a safe proxy refusal',
  { timeout: 10000 },
  async (t) => {
    const fixture = await httpProxy({ status: 403 });
    t.after(fixture.close);
    const proxy = {
      ...direct,
      enabled: true,
      host: '127.0.0.1',
      port: fixture.port,
      credentials: { username: 'fixture', password: 'fixture-proxy-secret' },
    };
    const proxyRefused = (error) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.details?.code, 'PROXY_CONNECT');
      assert.match(error.message, /代理无法建立连接/);
      assert.doesNotMatch(error.message, /fixture-.*-secret|ssh\.fixture\.invalid/);
      return true;
    };
    await assert.rejects(
      connectHost('', passwordProfile, { hostKey: null }, proxy, t.signal),
      proxyRefused,
    );
    await assert.rejects(
      probeAuthentication(passwordProfile, wrongHostKey, proxy, t.signal),
      proxyRefused,
    );
    assert.equal(fixture.records.length, 2);
  },
);

test(
  'SSH reconnect distinguishes rejected credentials from a changed host key',
  { timeout: 10000 },
  async (t) => {
    const password = 'test-only';
    const fixture = await forwardingSSH({ password });
    t.after(fixture.close);
    const profile = { ...passwordProfile, host: '127.0.0.1', port: fixture.port, password };
    await assert.rejects(
      connectHost(
        '',
        { ...profile, password: passwordProfile.password },
        { hostKey: null },
        direct,
        t.signal,
      ),
      (error) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.kind, 'permission-denied');
        assert.equal(error.details?.code, 'SSH_AUTH_REJECTED');
        assert.doesNotMatch(error.message, /fixture-ssh-secret/);
        return true;
      },
    );
    await assert.rejects(connectHost('', profile, { hostKey: wrongHostKey }, direct, t.signal), {
      kind: 'permission-denied',
      message: '服务器提供的 SSH 主机公钥指纹与预期不一致。',
    });
  },
);

test('an unreadable private key is reported without disclosing its path', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alune-ssh-key-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profile = {
    ...passwordProfile,
    authType: 'privateKey',
    password: undefined,
    privateKeyPath: join(directory, 'fixture-private-key'),
  };
  await assert.rejects(connectHost('', profile, { hostKey: null }, direct, t.signal), (error) => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.details?.code, 'SSH_KEY_READ_FAILED');
    assert.doesNotMatch(error.message, /fixture-private-key/);
    return true;
  });
});
