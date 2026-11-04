import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// Runtime-only cipher port; ciphertext and plaintext never belong in read RPC results.
export interface SecretStorage {
  available: boolean;
  description: string;
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
  close?: () => void;
}

function readKey(file: string, repairPermissions: boolean): Buffer {
  if (lstatSync(file).isSymbolicLink()) throw new Error('Invalid local secret key');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size !== 32 || (process.getuid && info.uid !== process.getuid()))
      throw new Error('Invalid local secret key');
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
      if (!repairPermissions) throw new Error('Unsafe source key permissions');
      fchmodSync(fd, 0o600);
    }
    const key = readFileSync(fd);
    if (key.length !== 32) throw new Error('Invalid local secret key');
    return key;
  } finally {
    closeSync(fd);
  }
}

function loadLocalKey(dataDir: string, filename: string, create: boolean): Buffer {
  const file = join(dataDir, filename);
  try {
    return readKey(file, create);
  } catch (error) {
    // Never replace an unreadable or damaged key: existing credentials need it.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error;
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, randomBytes(32), {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    try {
      // Publish a complete key without overwriting one created by another process.
      linkSync(temp, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return readKey(file, true);
  } finally {
    rmSync(temp, { force: true });
  }
}

// Keep the existing key filename so previously saved AI credentials remain readable.
function fileCipher(dataDir: string, filename: string, create: boolean): SecretStorage {
  let key: Buffer | undefined;
  try {
    key = loadLocalKey(dataDir, filename, create);
  } catch {
    // Keep Git and providers without authentication usable if storage is unavailable.
  }
  let enabled = true;
  return {
    get available() {
      return enabled && Boolean(key);
    },
    set available(value: boolean) {
      enabled = Boolean(value);
    },
    description: key
      ? '凭据已使用此设备自动生成的本机密钥加密保存。'
      : '本机密钥存储不可用，请检查应用数据目录权限或恢复密钥文件后重启。无需认证的服务仍可使用。',
    encrypt(text) {
      if (!key) throw new Error('Secret storage unavailable');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return `aes-gcm:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`;
    },
    decrypt(text) {
      if (!key || !text.startsWith('aes-gcm:')) throw new Error('Secret storage unavailable');
      const data = Buffer.from(text.slice(8), 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
    close() {
      key?.fill(0);
      key = undefined;
    },
  };
}

/** Compatibility constructor for the existing standalone service. */
export function localSecretStorage(dataDir: string): SecretStorage {
  return fileCipher(dataDir, 'ai-master-key', true);
}
/** Legacy import must never create a replacement source key. */
export function readLegacySecretStorage(dataDir: string): SecretStorage {
  return fileCipher(dataDir, 'ai-master-key', false);
}
/** The new Agent keeps its key separate from a legacy service in the parent directory. */
export function agentFileSecretStorage(dataDir: string, create: boolean): SecretStorage {
  return fileCipher(dataDir, 'agent-master-key', create);
}
