import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AiSettingsStore } from './ai-settings';
import { localSecretStorage } from './secret-storage';

describe('AI settings and protected keys', () => {
  let dir: string;
  let store: AiSettingsStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remote-git-ai-settings-'));
    store = new AiSettingsStore(
      join(dir, 'settings.json'),
      localSecretStorage(dir),
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const input = (name = 'Test') => ({
    name,
    protocol: 'openai' as const,
    baseUrl: 'http://127.0.0.1:9999/v1',
    enabled: true,
    models: [{ id: 'test/model', name: 'Test model', enabled: true }],
    apiKey: 'test-secret-not-for-production',
  });

  it('seeds four providers and Chinese Conventional Commits without selecting a disabled model', () => {
    expect(store.read().providers.map((p) => p.id)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'deepseek',
    ]);
    expect(store.read().commit).toEqual({
      providerId: null,
      modelId: null,
      language: 'zh-CN',
      format: 'conventional',
      prompt: '',
    });
  });

  it('persists encrypted keys and preferences across restart without returning plaintext or ciphertext', () => {
    store.saveProvider('openai', input(), store.read().revision);
    store.saveCommit(
      {
        providerId: 'openai',
        modelId: 'test/model',
        language: 'en',
        format: 'natural',
        prompt: 'Mention purpose',
      },
      store.read().revision,
    );
    const disk = readFileSync(join(dir, 'settings.json'), 'utf8');
    expect(disk).not.toContain(input().apiKey);
    expect(disk).toContain('aes-gcm:');
    expect(statSync(join(dir, 'settings.json')).mode & 0o777).toBe(0o600);
    const restarted = new AiSettingsStore(
      join(dir, 'settings.json'),
      localSecretStorage(dir),
    );
    expect(restarted.read()).toEqual(store.read());
    expect(restarted.key('openai')).toBe(input().apiKey);
    const read = JSON.stringify(restarted.read());
    expect(read).not.toContain(input().apiKey);
    expect(read).not.toContain('encryptedKey');
    expect(restarted.provider('openai').hasApiKey).toBe(true);
  });

  it('isolates custom providers, keeps omitted keys and explicitly clears keys', () => {
    store.saveProvider(undefined, input('A'), store.read().revision);
    store.saveProvider(
      undefined,
      { ...input('B'), protocol: 'gemini', apiKey: 'second-secret' },
      store.read().revision,
    );
    const a = store.read().providers.find((p) => p.name === 'A')!;
    const b = store.read().providers.find((p) => p.name === 'B')!;
    expect(a.id).not.toBe(b.id);
    store.saveProvider(a.id, { ...a, name: 'Renamed' }, store.read().revision);
    expect(store.key(a.id)).toBe(input().apiKey);
    expect(store.key(b.id)).toBe('second-secret');
    store.saveProvider(
      a.id,
      { ...store.provider(a.id), apiKey: null },
      store.read().revision,
    );
    expect(store.key(a.id)).toBe('');
    expect(store.provider(a.id).hasApiKey).toBe(false);
    expect(store.key(b.id)).toBe('second-secret');
  });

  it.each(['provider', 'model'])(
    'clears the selected default when its %s is disabled',
    (kind) => {
      store.saveProvider('openai', input(), store.read().revision);
      store.saveCommit(
        { ...store.read().commit, providerId: 'openai', modelId: 'test/model' },
        store.read().revision,
      );
      const p = store.provider('openai');
      store.saveProvider(
        p.id,
        {
          ...p,
          enabled: kind !== 'provider',
          models: p.models.map((m) => ({ ...m, enabled: kind !== 'model' })),
        },
        store.read().revision,
      );
      expect(store.read().commit.providerId).toBeNull();
      expect(() =>
        store.saveCommit(
          { ...store.read().commit, providerId: p.id, modelId: 'test/model' },
          store.read().revision,
        ),
      ).toThrow('已启用');
    },
  );

  it.each(['delete', 'change ID'])(
    'clears and persists the default after %s without changing other preferences or keys',
    (operation) => {
      store.saveProvider('openai', input(), store.read().revision);
      const commit = {
        ...store.read().commit,
        providerId: 'openai',
        modelId: 'test/model',
        prompt: 'Keep the team convention',
      };
      store.saveCommit(commit, store.read().revision);
      const provider = store.provider('openai');
      const models =
        operation === 'delete'
          ? []
          : [{ ...provider.models[0], id: 'replacement/model' }];
      store.saveProvider(
        provider.id,
        { ...provider, models },
        store.read().revision,
      );
      const restarted = new AiSettingsStore(
        join(dir, 'settings.json'),
        localSecretStorage(dir),
      );
      expect(restarted.provider(provider.id).models).toEqual(models);
      expect(restarted.read().commit).toEqual({
        ...commit,
        providerId: null,
        modelId: null,
      });
      expect(restarted.key(provider.id)).toBe(input().apiKey);
    },
  );

  it('keeps the default when changing only its display name or deleting another model', () => {
    store.saveProvider(
      'openai',
      {
        ...input(),
        models: [
          ...input().models,
          { id: 'other/model', name: 'Other model', enabled: false },
        ],
      },
      store.read().revision,
    );
    const commit = {
      ...store.read().commit,
      providerId: 'openai',
      modelId: 'test/model',
    };
    store.saveCommit(commit, store.read().revision);
    store.saveProvider(
      'openai',
      {
        ...store.provider('openai'),
        models: [{ ...input().models[0], name: 'Renamed model' }],
      },
      store.read().revision,
    );
    const restarted = new AiSettingsStore(
      join(dir, 'settings.json'),
      localSecretStorage(dir),
    );
    expect(restarted.read().commit).toEqual(commit);
    expect(restarted.provider('openai').models).toEqual([
      { id: 'test/model', name: 'Renamed model', enabled: true },
    ]);
  });

  it('rejects stale writes, duplicate model IDs, credentialed URLs and secret reuse at a changed endpoint', () => {
    const before = store.read();
    store.saveProvider('openai', input(), before.revision);
    expect(() =>
      store.saveProvider('openai', input(), before.revision),
    ).toThrow('已变化');
    expect(() =>
      store.saveProvider(
        'openai',
        { ...input(), models: [input().models[0], input().models[0]] },
        store.read().revision,
      ),
    ).toThrow('重复');
    expect(() =>
      store.saveProvider(
        'openai',
        { ...input(), baseUrl: 'https://user:secret@host/v1' },
        store.read().revision,
      ),
    ).toThrow('API 地址');
    expect(() =>
      store.saveProvider(
        'openai',
        {
          ...store.provider('openai'),
          baseUrl: 'https://different.example/v1',
        },
        store.read().revision,
      ),
    ).toThrow('重新输入');
  });

  it('refuses unprotected secrets but supports no-key self-hosted services', () => {
    const blockedDir = join(dir, 'not-a-directory');
    writeFileSync(blockedDir, 'file blocks data directory creation');
    const unavailable = new AiSettingsStore(
      join(dir, 'no-key.json'),
      localSecretStorage(blockedDir),
    );
    expect(() =>
      unavailable.saveProvider('openai', input(), unavailable.read().revision),
    ).toThrow('本机密钥存储不可用');
    unavailable.saveProvider(
      'openai',
      { ...input(), apiKey: undefined },
      unavailable.read().revision,
    );
    expect(unavailable.key('openai')).toBe('');
  });

  it('fails closed on an incorrect local key and on corrupt configuration', () => {
    store.saveProvider('openai', input(), store.read().revision);
    const wrong = new AiSettingsStore(
      join(dir, 'settings.json'),
      localSecretStorage(join(dir, 'other-device')),
    );
    expect(() => wrong.key('openai')).toThrow('无法解密');
    expect(wrong.provider('openai').hasApiKey).toBe(true);
    writeFileSync(join(dir, 'corrupt.json'), '{');
    expect(() =>
      new AiSettingsStore(
        join(dir, 'corrupt.json'),
        localSecretStorage(dir),
      ).read(),
    ).toThrow('无法读取');
  });

  it('whitelists configuration responses even if a legacy file contains extra credential fields', () => {
    store.saveProvider('openai', input(), store.read().revision);
    const file = join(dir, 'settings.json');
    const legacy = JSON.parse(readFileSync(file, 'utf8'));
    legacy.providers[0].apiKey = 'legacy-key-must-not-leak';
    legacy.commit.apiKey = 'legacy-key-must-not-leak';
    writeFileSync(file, JSON.stringify(legacy));
    const restored = new AiSettingsStore(file, localSecretStorage(dir));
    expect(JSON.stringify(restored.read())).not.toContain('legacy-key');
    expect(JSON.stringify(restored.read())).not.toContain('apiKey');
  });
});
