import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  assertRegularFile,
  privateDirectory,
  protectPrivatePaths,
  statePathExists,
} from '../private-files';
import { StateFault, type JsonDocument, type SecretCipher } from '../../ports/state';
import { keychainMasterKey } from './keychain';
import { dpapi } from './dpapi';

type Backend = 'keychain' | 'dpapi' | 'file';
type Descriptor = {
  version: 1;
  agentId: string;
  keyId: string;
  backend: Backend;
  status: 'pending' | 'ready';
  fingerprint?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProtectedSecrets extends SecretCipher {
  close(): void;
}
export interface ProtectedSecretOptions {
  // Only the state owner can establish that no existing credentials need a key.
  allowInitialize: boolean;
  backend?: Backend;
  signal?: AbortSignal;
  // Explicit isolated Keychain is useful for native tests, never accepted from RPC.
  keychain?: string;
}

function descriptor(value: unknown, agentId: string): Descriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new StateFault(
      'corrupt',
      'Invalid credential key descriptor; restore the original state',
    );
  const item = value as Descriptor;
  if (
    item.version !== 1 ||
    item.agentId !== agentId ||
    !uuid.test(item.keyId) ||
    !['keychain', 'dpapi', 'file'].includes(item.backend) ||
    !['pending', 'ready'].includes(item.status) ||
    (item.status === 'ready' && !/^[a-f0-9]{64}$/.test(item.fingerprint ?? '')) ||
    (item.status === 'pending' && item.fingerprint !== undefined) ||
    Object.keys(item).some(
      (key) => !['version', 'agentId', 'keyId', 'backend', 'status', 'fingerprint'].includes(key),
    )
  )
    throw new StateFault(
      'corrupt',
      'Invalid credential key descriptor; restore the original state',
    );
  return item;
}

async function loadKey(
  directory: string,
  item: Descriptor,
  options: ProtectedSecretOptions,
): Promise<Buffer> {
  const create = item.status === 'pending';
  if (item.backend === 'keychain') {
    const key = await keychainMasterKey(item.keyId, {
      create,
      keychain: options.keychain,
      signal: options.signal,
    });
    if (!key)
      throw new StateFault(
        'unavailable',
        'The original Keychain key is missing; it was not replaced',
      );
    return key;
  }
  if (item.backend === 'dpapi' && process.platform !== 'win32')
    throw new StateFault('unavailable', 'This credential key requires its original Windows user');
  const root = await privateDirectory(join(directory, 'keys'), options.signal);
  const file = join(root, `${item.keyId}.${item.backend === 'file' ? 'key' : 'dpapi'}`);
  if (!statePathExists(file)) {
    if (!create)
      throw new StateFault(
        'unavailable',
        'The original credential key is missing; it was not replaced',
      );
    const candidate = randomBytes(32);
    let encoded: Buffer | undefined;
    try {
      encoded =
        item.backend === 'file'
          ? candidate
          : await dpapi('protect', candidate, `${item.agentId}:${item.keyId}`, options.signal);
      options.signal?.throwIfAborted();
      // The writer lease prevents a concurrent Agent. Exclusive creation also
      // refuses to replace an existing key after an interrupted initialization.
      writeFileSync(file, encoded, { flag: 'wx', mode: 0o600, flush: true });
      if (process.platform !== 'win32') {
        const directoryFd = openSync(root, 'r');
        try {
          fsyncSync(directoryFd);
        } finally {
          closeSync(directoryFd);
        }
      }
    } finally {
      candidate.fill(0);
      encoded?.fill(0);
    }
  }
  assertRegularFile(file);
  await protectPrivatePaths([file], options.signal);
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let encoded: Buffer | undefined;
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size < 32 || info.size > 65536)
      throw new StateFault('corrupt', 'Credential key file is invalid; it was not replaced');
    encoded = readFileSync(fd);
    const key =
      item.backend === 'file'
        ? Buffer.from(encoded)
        : await dpapi('unprotect', encoded, `${item.agentId}:${item.keyId}`, options.signal);
    if (key.length !== 32) {
      key.fill(0);
      throw new StateFault('corrupt', 'Credential key has an invalid size');
    }
    return key;
  } finally {
    closeSync(fd);
    encoded?.fill(0);
  }
}

/** Must be opened under the Agent's state writer lease; no automatic backend fallback. */
export async function openProtectedSecrets(
  directory: string,
  agentId: string,
  document: JsonDocument,
  options: ProtectedSecretOptions,
): Promise<ProtectedSecrets> {
  if (!uuid.test(agentId)) throw new StateFault('invalid-input', 'Invalid Agent identity');
  options.signal?.throwIfAborted();
  let value = document.read();
  if (value === undefined) {
    if (!options.allowInitialize)
      throw new StateFault(
        'unavailable',
        'Credential key descriptor is missing; restore the original state',
      );
    value = {
      version: 1,
      agentId,
      keyId: randomUUID(),
      backend:
        options.backend ??
        (process.platform === 'darwin'
          ? 'keychain'
          : process.platform === 'win32'
            ? 'dpapi'
            : 'file'),
      status: 'pending',
    } satisfies Descriptor;
    // Persist intent before creating a key. No caller can encrypt until ready.
    document.write(value);
  }
  const item = descriptor(value, agentId);
  if (item.status === 'pending' && !options.allowInitialize)
    throw new StateFault(
      'unavailable',
      'Credential key initialization requires an empty credential store',
    );
  if (options.backend !== undefined && options.backend !== item.backend)
    throw new StateFault('conflict', 'Credential backend is already fixed for this Agent');
  let key: Buffer | undefined;
  try {
    key = await loadKey(directory, item, options);
    const fingerprint = createHash('sha256').update(key).digest('hex');
    if (item.status === 'ready' && fingerprint !== item.fingerprint)
      throw new StateFault(
        'corrupt',
        'Credential key does not match this state; it was not replaced',
      );
    options.signal?.throwIfAborted();
    if (item.status === 'pending') document.write({ ...item, status: 'ready', fingerprint });
    const material = key;
    let closed = false;
    const aad = Buffer.from(`alune-agent-secret:1:${agentId}:${item.keyId}`);
    return {
      get available() {
        return !closed;
      },
      description:
        item.backend === 'file'
          ? '凭据使用仅当前用户可访问的本机密钥加密保存。'
          : '凭据使用当前用户的系统密钥存储保护。',
      encrypt(text) {
        if (closed) throw new StateFault('unavailable', 'Credential store is closed');
        if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024)
          throw new StateFault('invalid-input', 'Credential value is too large');
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', material, iv);
        cipher.setAAD(aad);
        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        return `aes-gcm:v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`;
      },
      decrypt(text) {
        if (closed) throw new StateFault('unavailable', 'Credential store is closed');
        try {
          if (typeof text !== 'string' || text.length > 1400000 || !text.startsWith('aes-gcm:v1:'))
            throw new Error();
          const payload = text.slice(11);
          const data = Buffer.from(payload, 'base64');
          if (data.length < 28 || data.toString('base64') !== payload) throw new Error();
          const decipher = createDecipheriv('aes-256-gcm', material, data.subarray(0, 12));
          decipher.setAAD(aad);
          decipher.setAuthTag(data.subarray(12, 28));
          return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(
            'utf8',
          );
        } catch {
          throw new StateFault('corrupt', 'Credential cannot be decrypted with this Agent key');
        }
      },
      close() {
        if (!closed) {
          closed = true;
          material.fill(0);
        }
      },
    };
  } catch (error) {
    key?.fill(0);
    options.signal?.throwIfAborted();
    if (error instanceof StateFault) throw error;
    throw new StateFault(
      'unavailable',
      'Credential storage is unavailable; existing data was retained',
    );
  }
}
