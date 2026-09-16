// Electron protects ciphertext with Keychain (macOS), DPAPI (Windows), or an OS
// secret store (Linux). Refuse Chromium's unprotected Linux fallback.
function createAiSecretStorage(safeStorage) {
  const available =
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  return {
    available,
    description: available
      ? 'API Key 已使用此设备的系统密钥存储保护。'
      : '系统密钥存储不可用，请解锁钥匙串或启用系统密钥服务后重启应用。',
    encrypt(value) {
      if (!available) throw new Error('System secret storage unavailable');
      return `safe-storage:${safeStorage.encryptString(value).toString('base64')}`;
    },
    decrypt(value) {
      if (!available || !value.startsWith('safe-storage:'))
        throw new Error('System secret storage unavailable');
      return safeStorage.decryptString(Buffer.from(value.slice(13), 'base64'));
    },
  };
}
module.exports = { createAiSecretStorage };
