import { isWindowsPath, quotePosixArgument } from './git-shell';

// Select the remote shell from the registered path, not the Alune host OS.
export function terminalShellCommands(cwd: string): { check: string; start: string } {
  if (!cwd || cwd.includes('\0') || (!isWindowsPath(cwd) && !cwd.startsWith('/')))
    throw new Error('终端需要有效的绝对启动目录。');

  if (isWindowsPath(cwd)) {
    // SFTP may report /C:/..., while Git normally reports C:/....
    const directory = cwd.replace(/^\/([a-z]:[\\/])/i, '$1').replace(/\//g, '\\');
    const literal = `'${directory.replace(/'/g, "''")}'`;
    const script =
      `try { Set-Location -LiteralPath ${literal} -ErrorAction Stop } ` +
      'catch { [Console]::Error.WriteLine($_.Exception.Message); exit 125 }';
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    // Both cmd.exe and Windows PowerShell 5 can launch this command. Encoding
    // keeps paths out of the default SSH shell's expansion/quoting rules.
    return {
      check: `powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      start: `powershell -NoLogo -NoProfile -NoExit -EncodedCommand ${encoded}`,
    };
  }

  const script =
    'cd -P "$1" || exit 125; shell=${SHELL:-/bin/sh}; ' +
    '[ -x "$shell" ] || { printf "无法执行登录 shell\\n" >&2; exit 126; }';
  const command = (body: string) =>
    `/bin/sh -c ${quotePosixArgument(body)} alune ${quotePosixArgument(cwd)}`;
  return {
    check: command(script),
    start: command(`${script}; exec "$shell" -i`),
  };
}
