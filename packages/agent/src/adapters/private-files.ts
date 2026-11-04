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
$aluneAclStep = 'identity'
try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = $identity.User
  $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
  $system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $admins = 'S-1-5-32-544'
  $aluneAclStep = 'paths'
  [string[]]$paths = ConvertFrom-Json -InputObject $env:ALUNE_PRIVATE_PATHS
  foreach ($path in $paths) {
    $aluneAclStep = 'read-path'
    $attributes = [System.IO.File]::GetAttributes($path)
    if ($attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Reparse point refused' }
    $isDirectory = [System.IO.Directory]::Exists($path)
    $aluneAclStep = 'read-owner'
    if ($isDirectory) { $previous = [System.IO.Directory]::GetAccessControl($path) }
    else { $previous = [System.IO.File]::GetAccessControl($path) }
    $owner = $previous.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    $aluneAclStep = 'owner-check'
    if ($owner -ne $sid.Value -and -not ($owner -eq $admins -and $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator))) { throw 'Foreign owner refused' }
    $aluneAclStep = 'create-acl'
    if ($isDirectory) {
      $acl = [System.Security.AccessControl.DirectorySecurity]::new()
      $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    } else {
      $acl = [System.Security.AccessControl.FileSecurity]::new()
      $inherit = [System.Security.AccessControl.InheritanceFlags]::None
    }
    if ($owner -ne $sid.Value) { $acl.SetOwner($sid) }
    $acl.SetAccessRuleProtection($true, $false)
    $aluneAclStep = 'create-rule'
    foreach ($who in @($sid, $system)) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($who, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.InheritanceFlags]$inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
      $acl.AddAccessRule($rule)
    }
    $aluneAclStep = 'set-acl'
    if ($isDirectory) { [System.IO.Directory]::SetAccessControl($path, $acl) }
    else { [System.IO.File]::SetAccessControl($path, $acl) }
  }
} catch {
  $failure = $_.Exception
  for ($depth = 0; $depth -lt 8 -and $failure.InnerException; $depth++) { $failure = $failure.InnerException }
  [Console]::Error.WriteLine('ALUNE_ACL_FAILURE:' + $aluneAclStep + ':' + $failure.GetType().FullName)
  exit 1
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
  let diagnostic = 'filesystem';
  try {
    if (process.platform === 'win32' && existing.length) {
      const controller = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
      await new Promise<void>((resolve, reject) => {
        let failure: Error | undefined;
        let stderr = '';
        diagnostic = 'helper-start';
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
            Buffer.from(aclScript, 'utf16le').toString('base64'),
          ],
          {
            env: { ...process.env, ALUNE_PRIVATE_PATHS: JSON.stringify(existing) },
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe'],
            signal: controller,
          },
        );
        child.stderr.on('data', (chunk: Buffer) => {
          stderr = (stderr + chunk.toString('utf8')).slice(-4096);
        });
        child.once('error', (error) => {
          failure = error;
        });
        child.once('close', (code) => {
          const reason = /ALUNE_ACL_FAILURE:([a-z-]+):([A-Za-z0-9_.]+)/.exec(stderr);
          diagnostic = controller.aborted
            ? 'helper-timeout'
            : reason
              ? reason[1] + '/' + reason[2]
              : /ParserError/.test(stderr)
                ? 'helper-parse'
                : 'helper-exit';
          if (failure) reject(failure);
          else if (code === 0) resolve();
          else reject(new Error('ACL protection failed'));
        });
      });
    } else
      for (const file of existing) chmodSync(file, lstatSync(file).isDirectory() ? 0o700 : 0o600);
  } catch {
    signal?.throwIfAborted();
    throw new StateFault('permission', `Cannot protect Agent state permissions (${diagnostic})`);
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
