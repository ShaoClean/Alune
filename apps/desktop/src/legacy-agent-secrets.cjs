// Main-process-only bridge for a dedicated import child. No renderer IPC or TCP
// endpoint is registered. The caller supplies exact ciphertexts read from the
// stopped legacy store; the child cannot use this as a general decrypt oracle.
const { createHash } = require('node:crypto');
function bridgeLegacyAgentSecrets(child, storage, ciphertexts, { hashed = false } = {}) {
  if (!child || typeof child.send !== 'function' || !child.connected)
    throw new Error('Private import child IPC is required');
  const allowed = new Set(ciphertexts);
  let closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    allowed.clear();
    child.off('message', receive);
    child.off('exit', dispose);
    child.off('disconnect', dispose);
  };
  const receive = (message) => {
    if (closed || !message || message.kind !== 'alune.legacy.decrypt') return;
    const { id, ciphertext } = message;
    if (typeof id !== 'string' || id.length > 100) return;
    const response = { kind: 'alune.legacy.decrypted', id, ok: false };
    try {
      const key =
        hashed && typeof ciphertext === 'string' && ciphertext.length <= 1400000
          ? createHash('sha256').update(ciphertext).digest('hex')
          : ciphertext;
      if (
        !storage.available ||
        typeof ciphertext !== 'string' ||
        ciphertext.length > 1400000 ||
        !ciphertext.startsWith('safe-storage:') ||
        !allowed.has(key)
      )
        throw new Error();
      const plaintext = storage.decrypt(ciphertext);
      if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > 1024 * 1024)
        throw new Error();
      allowed.delete(key);
      response.ok = true;
      response.plaintext = plaintext;
    } catch {
      /* Never forward native errors, original values or ciphertext. */
    }
    if (child.connected)
      child.send(response, (error) => {
        if (error) dispose();
      });
    else dispose();
  };
  child.on('message', receive);
  child.once('exit', dispose);
  child.once('disconnect', dispose);
  return dispose;
}
module.exports = { bridgeLegacyAgentSecrets };
