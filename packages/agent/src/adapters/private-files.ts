import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StateFault } from '../ports/state';

const aclScript = `
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$admins = 'S-1-5-32-544'
$paths = @($env:ALUNE_PRIVATE_PATHS | ConvertFrom-Json)
foreach ($path in $paths) {
  $item = Get-Item -LiteralPath $path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point refused' }
  $previous = Get-Acl -LiteralPath $path
  $owner = $previous.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($owner -ne $sid.Value -and -not ($owner -eq $admins -and $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))) { throw 'Foreign owner refused' }
  if ($item.PSIsContainer) {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  } else {
    $acl = New-Object Security.AccessControl.FileSecurity
    $inherit = [Security.AccessControl.InheritanceFlags]::None
  }
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($who in @($sid, $system)) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($who, 'FullControl', $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}
`;

export function assertRegularFile(file: string): void {
  if (!statePathExists(file)) return;
  const info = lstatSync(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink > 1 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new StateFault('permission', 'State file must be a regular file owned by this user');
}
export function statePathExists(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export function stateDirectory(directory: string): void {
  if (statePathExists(directory)) {
    const info = lstatSync(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new StateFault(
        'permission',
        'State directory cannot be a link or belong to another user',
      );
  } else mkdirSync(directory, { recursive: true, mode: 0o700 });
}
export async function protectPrivatePaths(paths: string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const existing = paths.filter(statePathExists);
  for (const file of existing) {
    const info = lstatSync(file);
    if (
      (!info.isDirectory() && !info.isFile()) ||
      info.isSymbolicLink() ||
      (info.isFile() && info.nlink > 1) ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new StateFault(
        'permission',
        'State paths must be owned by this user and cannot be links',
      );
  }
  try {
    if (process.platform === 'win32' && existing.length) {
      const controller = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
      await new Promise<void>((resolve, reject) => {
        let failure: Error | undefined;
        const child = spawn(
          'powershell.exe',
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(aclScript, 'utf16le').toString('base64'),
          ],
          {
            env: { ...process.env, ALUNE_PRIVATE_PATHS: JSON.stringify(existing) },
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'ignore'],
            signal: controller,
          },
        );
        child.once('error', (error) => {
          failure = error;
        });
        child.once('close', (code) =>
          failure
            ? reject(failure)
            : code === 0
              ? resolve()
              : reject(new Error('ACL protection failed')),
        );
      });
    } else
      for (const file of existing) chmodSync(file, lstatSync(file).isDirectory() ? 0o700 : 0o600);
  } catch {
    signal?.throwIfAborted();
    throw new StateFault('permission', 'Cannot protect Agent state permissions');
  }
}
export async function privateDirectory(directory: string, signal?: AbortSignal): Promise<string> {
  stateDirectory(directory);
  await protectPrivatePaths([directory], signal);
  return realpathSync.native(directory);
}
export function atomicPrivateJson(file: string, value: unknown): void {
  const temporary = join(dirname(file), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n', {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    renameSync(temporary, file);
    // Directory fsync makes the pointer publication durable where supported.
    if (process.platform !== 'win32') {
      const fd = openSync(dirname(file), 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}
