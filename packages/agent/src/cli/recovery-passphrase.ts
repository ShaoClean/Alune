import { StateFault } from '../ports/state';

/** Read a bounded private pipe; never accept a passphrase in argv or environment. */
export async function recoveryPassphrase(signal?: AbortSignal): Promise<Buffer> {
  if (process.stdin.isTTY)
    throw new StateFault(
      'invalid-input',
      'Provide the recovery passphrase through stdin, not a command argument or environment variable',
    );
  const control = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60000)]);
  control.throwIfAborted();
  const chunks: Buffer[] = [];
  let bytes = 0;
  const abort = () => process.stdin.destroy(control.reason);
  control.addEventListener('abort', abort, { once: true });
  try {
    for await (const data of process.stdin) {
      control.throwIfAborted();
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      bytes += chunk.length;
      if (bytes > 1026)
        throw new StateFault('invalid-input', 'Recovery passphrase exceeds the supported length');
      chunks.push(chunk);
    }
    const joined = Buffer.concat(chunks);
    let length = joined.length;
    if (joined[length - 1] === 10) length--;
    if (joined[length - 1] === 13) length--;
    const passphrase = Buffer.from(joined.subarray(0, length));
    joined.fill(0);
    if (passphrase.length < 12 || passphrase.length > 1024) {
      passphrase.fill(0);
      throw new StateFault('invalid-input', 'Recovery passphrase must contain 12–1024 UTF-8 bytes');
    }
    return passphrase;
  } finally {
    control.removeEventListener('abort', abort);
    for (const chunk of chunks) chunk.fill(0);
  }
}
