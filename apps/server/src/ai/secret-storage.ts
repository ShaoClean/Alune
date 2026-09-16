import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// The desktop supplies Electron safeStorage from the main process, never via IPC to the page.
export interface AiSecretStorage {
  available: boolean;
  description: string;
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
}

function readKey(file: string): Buffer {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.size !== 32 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error('Invalid local secret key');
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      fchmodSync(fd, 0o600);
    const key = readFileSync(fd);
    if (key.length !== 32) throw new Error('Invalid local secret key');
    return key;
  } finally {
    closeSync(fd);
  }
}

function loadLocalKey(dataDir: string): Buffer {
  const file = join(dataDir, 'ai-master-key');
  try {
    return readKey(file);
  } catch (error) {
    // Never replace an unreadable or damaged key: existing credentials need it.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
    return readKey(file);
  } finally {
    rmSync(temp, { force: true });
  }
}

// Standalone mode manages its own key; provider API Keys always come from settings.
export function localSecretStorage(dataDir: string): AiSecretStorage {
  let key: Buffer | undefined;
  try {
    key = loadLocalKey(dataDir);
  } catch {
    // Keep Git and providers without authentication usable if storage is unavailable.
  }
  return {
    available: Boolean(key),
    description: key
      ? 'API Key 已使用此设备自动生成的本机密钥加密保存。'
      : '本机密钥存储不可用，请检查应用数据目录权限或恢复密钥文件后重启。无需认证的服务仍可使用。',
    encrypt(text) {
      if (!key) throw new Error('Secret storage unavailable');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final(),
      ]);
      return `aes-gcm:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`;
    },
    decrypt(text) {
      if (!key || !text.startsWith('aes-gcm:'))
        throw new Error('Secret storage unavailable');
      const data = Buffer.from(text.slice(8), 'base64');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        data.subarray(0, 12),
      );
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
