export const isWindowsPath = (path: string) => /^(?:\/?[a-z]:[\\/]|\\\\|\/\/)/i.test(path);
export const quotePosixArgument = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

// Windows OpenSSH commonly starts cmd.exe; encoded PowerShell avoids both cmd
// expansion and PowerShell interpolation of repository paths and file names.
export function gitFileCommand(
  repoPath: string,
  args: string[],
  environment: Record<string, string> = {},
): string {
  if (Object.keys(environment).some((name) => !/^[A-Z_][A-Z0-9_]*$/i.test(name)))
    throw new Error('Invalid command environment name');
  const argv = ['--literal-pathspecs', '-C', repoPath, ...args];
  if (isWindowsPath(repoPath)) {
    const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const nativeArg = (value: string) =>
      `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
    // Relay raw streams: PowerShell's text pipeline would alter porcelain -z,
    // Unicode paths and final newlines. ProcessStartInfo works on PowerShell 5.
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      '$gitProcess = New-Object System.Diagnostics.Process',
      "$gitProcess.StartInfo.FileName = 'git'",
      `$gitProcess.StartInfo.Arguments = ${literal(argv.map(nativeArg).join(' '))}`,
      '$gitProcess.StartInfo.UseShellExecute = $false',
      ...Object.entries(environment).map(
        ([name, value]) =>
          `$gitProcess.StartInfo.EnvironmentVariables[${literal(name)}] = ${literal(value)}`,
      ),
      '$gitProcess.StartInfo.RedirectStandardOutput = $true',
      '$gitProcess.StartInfo.RedirectStandardError = $true',
      '$null = $gitProcess.Start()',
      '$stdoutCopy = $gitProcess.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())',
      '$stderrCopy = $gitProcess.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())',
      '$gitProcess.WaitForExit()',
      // Windows PowerShell exposes VoidTaskResult as pipeline output. Discard
      // it explicitly so only Git's original bytes reach the SSH streams.
      '$null = $stdoutCopy.GetAwaiter().GetResult()',
      '$null = $stderrCopy.GetAwaiter().GetResult()',
      'exit $gitProcess.ExitCode',
    ].join('; ');
    return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
  }
  const prefix = Object.entries(environment)
    .map(([name, value]) => `${name}=${quotePosixArgument(value)}`)
    .join(' ');
  return `${prefix ? `env ${prefix} ` : ''}git ${argv.map(quotePosixArgument).join(' ')}`;
}
