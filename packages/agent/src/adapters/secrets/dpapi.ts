import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { StateFault } from '../../ports/state';

const script = `
$ErrorActionPreference='Stop'
try {
  [void][System.Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')
  $operation=[Console]::In.ReadLine()
  [byte[]]$entropy=[Convert]::FromBase64String([Console]::In.ReadLine())
  [byte[]]$bytes=[Convert]::FromBase64String([Console]::In.ReadLine())
  if ($operation -eq 'protect') {
    [byte[]]$result=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  } elseif ($operation -eq 'unprotect') {
    [byte[]]$result=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else { throw 'Invalid operation' }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
  [Console]::Error.WriteLine('ALUNE_DPAPI_UNAVAILABLE')
  exit 1
} finally {
  if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
  if ($result) { [Array]::Clear($result,0,$result.Length) }
}
`;
export async function dpapi(
  operation: 'protect' | 'unprotect',
  data: Buffer,
  scope: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (process.platform !== 'win32')
    throw new StateFault('unavailable', 'DPAPI is only available on Windows');
  if (data.length > 65536 || Buffer.byteLength(scope) > 1024)
    throw new StateFault('invalid-input', 'Native key payload is too large');
  signal?.throwIfAborted();
  try {
    const control = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]);
    const output = await new Promise<string>((resolve, reject) => {
      let text = '';
      let failure: Error | undefined;
      const child = spawn(
        join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, signal: control },
      );
      child.once('error', (e) => {
        failure = e;
      });
      child.stdin.on('error', (e) => {
        failure = e;
      });
      child.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
        if (text.length > 131072) {
          failure = new Error('Native response limit');
          child.kill();
        }
      });
      child.once('close', (code) =>
        failure
          ? reject(failure)
          : code === 0
            ? resolve(text)
            : reject(new Error('Native key protection failed')),
      );
      child.stdin.end(
        `${operation}\n${Buffer.from(scope, 'utf8').toString('base64')}\n${data.toString('base64')}\n`,
      );
    });
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(output)) throw new Error();
    return Buffer.from(output, 'base64');
  } catch {
    signal?.throwIfAborted();
    throw new StateFault(
      'unavailable',
      'Windows user key protection is unavailable; the original data was retained',
    );
  }
}
