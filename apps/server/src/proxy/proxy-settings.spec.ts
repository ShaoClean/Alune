import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProxySettingsStore } from './proxy-settings';
import { localSecretStorage } from '../ai/secret-storage';

describe('device proxy settings', () => {
  let root: string;
  let store: ProxySettingsStore;
  const credentials = {
    action: 'replace' as const,
    username: 'proxy-username',
    password: 'private-password',
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'alune-proxy-settings-'));
    store = new ProxySettingsStore(
      join(root, 'network-proxy.json'),
      localSecretStorage(root),
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const input = () => ({
    ...store.read(),
    enabled: true,
    host: '127.0.0.1',
    port: 8080,
    authEnabled: true,
    credentials,
  });

  it('encrypts both credentials, never returns either, and restores them on restart', () => {
    const result = store.save(input());
    expect(result.hasCredentials).toBe(true);
    for (const value of [
      JSON.stringify(result),
      readFileSync(join(root, 'network-proxy.json'), 'utf8'),
    ])
      expect(value).not.toMatch(/proxy-username|private-password/);
    const restored = new ProxySettingsStore(
      join(root, 'network-proxy.json'),
      localSecretStorage(root),
    );
    expect(restored.read()).toEqual(result);
    expect(restored.snapshot().credentials).toEqual({
      username: credentials.username,
      password: credentials.password,
    });
  });
  it('preserves credentials while disabled and distinguishes keep, replace and clear', () => {
    store.save(input());
    store.save({ ...input(), enabled: false, credentials: { action: 'keep' } });
    expect(store.read().hasCredentials).toBe(true);
    expect(store.snapshot().credentials).toBeUndefined();
    store.save({ ...input(), credentials: { action: 'keep' } });
    expect(store.snapshot().credentials?.password).toBe(credentials.password);
    expect(() =>
      store.save({ ...input(), credentials: { action: 'clear' } }),
    ).toThrow('需要保存');
    store.save({
      ...input(),
      authEnabled: false,
      credentials: { action: 'clear' },
    });
    expect(store.read().hasCredentials).toBe(false);
  });
  it('rejects stale writes and reuse of credentials at another proxy', () => {
    const original = input();
    store.save(original);
    expect(() => store.save(original)).toThrow('已变化');
    expect(() =>
      store.save({
        ...input(),
        host: 'another.example',
        credentials: { action: 'keep' },
      }),
    ).toThrow('重新填写');
  });
  it.each([
    { host: 'http://localhost' },
    { host: 'user:password@host' },
    { port: 0 },
    { port: 65536 },
    { port: 80.5 },
    { protocol: 'file' },
    { enabled: 'yes' },
    { host: 'localhost\r\nheader' },
  ])(
    'rejects malformed settings without changing the revision: %j',
    (patch) => {
      const revision = store.read().revision;
      expect(() => store.save({ ...input(), ...patch } as any)).toThrow();
      expect(store.read().revision).toBe(revision);
    },
  );
  it('refuses plaintext fallback and preserves prior state when saving fails', () => {
    const unavailable = new ProxySettingsStore(join(root, 'missing.json'), {
      available: false,
      description: 'unavailable',
      encrypt: () => {
        throw new Error();
      },
      decrypt: () => {
        throw new Error();
      },
    });
    expect(() =>
      unavailable.save({ ...input(), revision: unavailable.read().revision }),
    ).toThrow('安全存储');
    const revision = store.read().revision;
    mkdirSync(join(root, 'network-proxy.json'));
    expect(() => store.save(input())).toThrow('保存失败');
    expect(store.read().revision).toBe(revision);
  });
  it('fails closed for unreadable configuration and encrypted credentials', () => {
    writeFileSync(join(root, 'bad.json'), '{');
    expect(() =>
      new ProxySettingsStore(
        join(root, 'bad.json'),
        localSecretStorage(root),
      ).snapshot(),
    ).toThrow('不会回退直连');
    store.save(input());
    const unavailable = new ProxySettingsStore(
      join(root, 'network-proxy.json'),
      {
        available: false,
        description: 'unavailable',
        encrypt: () => '',
        decrypt: () => {
          throw new Error('secret');
        },
      },
    );
    expect(() => unavailable.snapshot()).toThrow('不会回退直连');
    expect(() => unavailable.snapshot()).not.toThrow('secret');
    unavailable.save({
      ...unavailable.read(),
      enabled: false,
      credentials: { action: 'keep' },
    });
    expect(unavailable.read()).toMatchObject({
      enabled: false,
      hasCredentials: true,
    });
    expect(unavailable.snapshot().credentials).toBeUndefined();
  });
});
