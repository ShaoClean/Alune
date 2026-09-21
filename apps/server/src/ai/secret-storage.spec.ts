import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localSecretStorage } from './secret-storage';

describe('automatic local AI secret storage', () => {
  let root: string;
  let dir: string;
  let previousMasterKey: string | undefined;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'alune-local-secrets-'));
    dir = join(root, 'app-data');
    previousMasterKey = process.env.ALUNE_AI_MASTER_KEY;
    delete process.env.ALUNE_AI_MASTER_KEY;
  });
  afterEach(() => {
    if (previousMasterKey === undefined)
      delete process.env.ALUNE_AI_MASTER_KEY;
    else process.env.ALUNE_AI_MASTER_KEY = previousMasterKey;
    rmSync(root, { recursive: true, force: true });
  });

  it('creates protected storage without environment setup and reuses it on restart', () => {
    const secrets = localSecretStorage(dir);
    expect(secrets.available).toBe(true);
    const encrypted = secrets.encrypt('manually-entered-api-key');
    const file = join(dir, 'ai-master-key');
    const key = readFileSync(file);
    expect(key.length).toBe(32);
    expect(key.toString()).not.toContain('manually-entered-api-key');
    expect(readdirSync(dir)).toEqual(['ai-master-key']);
    if (process.platform !== 'win32') {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    // Even an old/invalid environment value must not change which local key is used.
    process.env.ALUNE_AI_MASTER_KEY = 'ignored-environment-value';
    const restarted = localSecretStorage(dir);
    expect(restarted.available).toBe(true);
    expect(restarted.decrypt(encrypted)).toBe('manually-entered-api-key');
    expect(readFileSync(file)).toEqual(key);
  });

  it('isolates data directories and rejects modified ciphertext', () => {
    const first = localSecretStorage(dir);
    const second = localSecretStorage(join(root, 'other-device'));
    const encrypted = first.encrypt('manual-api-key');
    expect(encrypted).not.toContain('manual-api-key');
    expect(first.encrypt('manual-api-key')).not.toBe(encrypted);
    expect(() => second.decrypt(encrypted)).toThrow();
    const modified = Buffer.from(encrypted.slice(8), 'base64');
    modified[modified.length - 1] ^= 1;
    expect(() =>
      first.decrypt(`aes-gcm:${modified.toString('base64')}`),
    ).toThrow();
    expect(() => first.decrypt('plaintext')).toThrow();
  });

  it('preserves a damaged key and fails closed instead of replacing it', () => {
    localSecretStorage(dir);
    const file = join(dir, 'ai-master-key');
    writeFileSync(file, 'damaged');
    const restored = localSecretStorage(dir);
    expect(restored.available).toBe(false);
    expect(() => restored.encrypt('manual-api-key')).toThrow('unavailable');
    expect(() => restored.decrypt('aes-gcm:invalid')).toThrow('unavailable');
    expect(readFileSync(file, 'utf8')).toBe('damaged');
  });

  it('reports an unusable data directory without throwing during startup', () => {
    writeFileSync(dir, 'not a directory');
    expect(localSecretStorage(dir).available).toBe(false);
    expect(readFileSync(dir, 'utf8')).toBe('not a directory');
  });

  (process.platform === 'win32' ? it.skip : it)(
    'restores owner-only POSIX permissions and refuses symlinked keys',
    () => {
      const secrets = localSecretStorage(dir);
      const encrypted = secrets.encrypt('manual-api-key');
      const file = join(dir, 'ai-master-key');
      chmodSync(file, 0o644);
      expect(localSecretStorage(dir).decrypt(encrypted)).toBe('manual-api-key');
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const target = join(root, 'key-target');
      writeFileSync(target, readFileSync(file));
      rmSync(file);
      symlinkSync(target, file);
      expect(localSecretStorage(dir).available).toBe(false);
      expect(readFileSync(target).length).toBe(32);
    },
  );
});
