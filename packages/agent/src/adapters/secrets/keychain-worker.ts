import { join } from 'node:path';

// Private child pipe: never inherit this stdout into the Agent protocol stream.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
  if (Buffer.byteLength(input) > 16384) process.exit(2);
});
process.stdin.on('end', () => {
  try {
    const request = JSON.parse(input);
    if (
      !['read', 'create'].includes(request.operation) ||
      typeof request.account !== 'string' ||
      (request.keychain !== undefined && typeof request.keychain !== 'string')
    )
      throw new Error();
    const native = require(join(__dirname, '../../native/keychain.node'));
    let key: Buffer | null;
    if (request.operation === 'read') key = native.read(request.account, request.keychain);
    else {
      if (typeof request.candidate !== 'string') throw new Error();
      const candidate = Buffer.from(request.candidate, 'base64');
      try {
        key = native.create(request.account, candidate, request.keychain);
      } finally {
        candidate.fill(0);
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, key: key?.toString('base64') ?? null }));
    key?.fill(0);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code:
          typeof code === 'string' && /^KEYCHAIN_[A-Z0-9_-]+$/.test(code)
            ? code
            : 'KEYCHAIN_UNAVAILABLE',
      }),
    );
    process.exitCode = 1;
  }
});
