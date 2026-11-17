import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { StateFault } from '../../ports/state';

export async function keychainMasterKey(
  account: string,
  options: { create: boolean; keychain?: string; signal?: AbortSignal },
): Promise<Buffer | null> {
  if (process.platform !== 'darwin')
    throw new StateFault('unavailable', 'Keychain is only available on macOS');
  options.signal?.throwIfAborted();
  const candidate = options.create ? randomBytes(32) : undefined;
  try {
    const signal = AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      AbortSignal.timeout(10000),
    ]);
    const result = await new Promise<string>((resolve, reject) => {
      let output = '';
      let failure: Error | undefined;
      const child = spawn(process.execPath, [join(__dirname, 'keychain-worker.js')], {
        stdio: ['pipe', 'pipe', 'ignore'],
        signal,
      });
      child.once('error', (e) => {
        failure = e;
      });
      child.stdin.on('error', (e) => {
        failure = e;
      });
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (Buffer.byteLength(output) > 16384) {
          failure = new Error('Native response limit');
          child.kill();
        }
      });
      child.once('close', () => (failure ? reject(failure) : resolve(output)));
      child.stdin.end(
        JSON.stringify({
          operation: options.create ? 'create' : 'read',
          account,
          ...(candidate ? { candidate: candidate.toString('base64') } : {}),
          ...(options.keychain ? { keychain: options.keychain } : {}),
        }),
      );
    });
    const parsed = JSON.parse(result);
    if (parsed.ok !== true)
      throw new StateFault(
        'unavailable',
        'Keychain is locked, unavailable or contains an invalid key; it was not replaced',
      );
    if (parsed.key === null) return null;
    if (typeof parsed.key !== 'string') throw new Error();
    const key = Buffer.from(parsed.key, 'base64');
    if (key.length !== 32) throw new Error();
    return key;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof StateFault) throw error;
    throw new StateFault('unavailable', 'Keychain operation failed; no key material was returned');
  } finally {
    candidate?.fill(0);
  }
}
