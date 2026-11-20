// Shell snippets contain only fixed program text, a validated digest, UUID and numeric port.
// Repository paths, profile fields, credentials and user input never enter a remote command.
const sh = (s: string) => "sh -c '" + s.replaceAll("'", "'\\''") + "'";
const ps = (s: string) =>
  'powershell.exe -NoLogo -NoProfile -NonInteractive -InputFormat None -OutputFormat Text -EncodedCommand ' +
  Buffer.from(
    "$ErrorActionPreference='Stop';[Environment]::CurrentDirectory=(Get-Location).ProviderPath;" +
      s,
    'utf16le',
  ).toString('base64');
export const unixProbe = sh('uname -s && uname -m; git --version || :');
export const windowsProbe = ps(
  "[Console]::WriteLine('Windows');[Console]::WriteLine([System.Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE'));if(Get-Command git -ErrorAction SilentlyContinue){git --version}",
);
export function targetFrom(output: string) {
  const [os, arch, git] = output.trim().split(/\r?\n/);
  const target = (
    {
      'Darwin:arm64': 'darwin-arm64',
      'Darwin:x86_64': 'darwin-x64',
      'Linux:x86_64': 'linux-x64',
      'Windows:AMD64': 'win32-x64',
    } as Record<string, string>
  )[os + ':' + arch];
  return { target, gitAvailable: !!git?.startsWith('git version ') };
}

export function bootstrapCommands(
  windows: boolean,
  digest: string,
  nonce: string,
  forwardPort?: number | 'blocked',
) {
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    !/^[a-f0-9-]{36}$/.test(nonce) ||
    (forwardPort !== undefined &&
      forwardPort !== 'blocked' &&
      (!Number.isSafeInteger(forwardPort) || forwardPort < 1 || forwardPort > 65535))
  )
    throw Error('Invalid bootstrap identifiers');
  const base = '.alune-ssh',
    run = base + '/run-' + nonce,
    archive = base + '/' + digest + '.tar.gz',
    part = base + '/upload-' + digest + '.part',
    temp = base + '/upload-' + nonce;
  const paths = { base, archive, part, temp };
  const sourceFile = (source: 'part' | 'temp') => {
    if (source === 'part') return part;
    if (source === 'temp') return temp;
    throw Error('Invalid upload source');
  };
  const arg = ' serve-remote' + (forwardPort ? ' --git-proxy-port ' + forwardPort : '');
  if (windows) {
    // Get-FileHash is an optional PowerShell module (often missing from
    // noninteractive OpenSSH environments). Hash the file as bytes in .NET.
    const check = (file: string) => `
      $sha=[Security.Cryptography.SHA256]::Create();
      $reader=[IO.File]::OpenRead('${file}');
      try { $actual=[BitConverter]::ToString($sha.ComputeHash($reader)).Replace('-','').ToLowerInvariant() }
      finally { $reader.Dispose(); $sha.Dispose() }
      if ($actual -ne '${digest}') { throw 'checksum' }`;
    const pruneStale = `
      Get-ChildItem -LiteralPath '${base}' -Force -ErrorAction SilentlyContinue |
        Where-Object { -not $_.PSIsContainer -and (($_.Name -like '*.tar.gz' -and $_.Name -ne '${digest}.tar.gz') -or $_.Name -like 'upload-*') } |
        ForEach-Object { Remove-Item -Force -LiteralPath $_.FullName -ErrorAction SilentlyContinue }`;
    return {
      paths,
      installed: ps("if(Test-Path -LiteralPath '" + archive + "'){[Console]::Write('present')}"),
      verified: ps(
        `if (Test-Path -LiteralPath '${archive}') {
           try {
             ${check(archive)}
             [Console]::Write('verified')
           } catch {
             if ([IO.File]::Exists('${archive}')) { [IO.File]::Delete('${archive}') }
           }
         }`,
      ),
      commit: (source: 'part' | 'temp') => {
        const file = sourceFile(source);
        return ps(
          `try {
             if (-not [IO.File]::Exists('${file}')) { throw 'missing' }
             ${check(file)}
             Move-Item -Force -LiteralPath '${file}' -Destination '${archive}';
             ${pruneStale}
           } finally { if ([IO.File]::Exists('${file}')) { [IO.File]::Delete('${file}') } }
           exit 0`,
        );
      },
      // Pure ASCII Base64 lines terminated by an explicit END line so fallback
      // upload works even when Windows OpenSSH DefaultShell is PowerShell 5.1.
      upload: (size: number) => {
        if (!Number.isSafeInteger(size) || size <= 0) throw Error('Invalid archive size');
        return ps(
          `[IO.Directory]::CreateDirectory('${base}') | Out-Null;
         try {
           $f=[IO.File]::Open('${temp}','CreateNew');
           try {
             $written=[int64]0;
             while ($true) {
               $line=[Console]::In.ReadLine();
               if ($null -eq $line) { throw 'Incomplete archive' }
               $trimmed=$line.Trim();
               if ($trimmed -eq 'END') { break }
               if ($trimmed.Length -eq 0) { continue }
               $bytes=[Convert]::FromBase64String($trimmed);
               $f.Write($bytes,0,$bytes.Length);
               $written+=$bytes.Length;
               if ($written -gt ${size}) { throw 'Archive exceeds expected size' }
             }
             if ($written -ne ${size}) { throw 'Incomplete archive' }
           } finally { $f.Dispose() }
           ${check(temp)}
           Move-Item -Force -LiteralPath '${temp}' -Destination '${archive}';
           ${pruneStale}
         } finally { if ([IO.File]::Exists('${temp}')) { [IO.File]::Delete('${temp}') } }
         exit 0`,
        );
      },
      prepare: ps(
        `${check(archive)}
         New-Item -ItemType Directory '${run}' | Out-Null;
         & (Join-Path $env:SystemRoot 'System32/tar.exe') -xzf '${archive}' -C '${run}';
         exit $LASTEXITCODE`,
      ),
      clean: ps(
        "Remove-Item -Force -Recurse -LiteralPath '" + run + "' -ErrorAction SilentlyContinue",
      ),
      serve:
        'cmd.exe /d /c "' +
        run.replaceAll('/', '\\') +
        '\\runtime\\node.exe ' +
        run.replaceAll('/', '\\') +
        '\\node_modules\\@alune\\agent\\bin\\alune-agent.cjs' +
        arg +
        ' & rmdir /s /q ' +
        run.replaceAll('/', '\\') +
        '"',
    };
  }
  const hash = (file: string) =>
    'if command -v sha256sum >/dev/null; then h=$(sha256sum ' +
    file +
    '); else h=$(shasum -a 256 ' +
    file +
    '); fi; test "${h%% *}" = ' +
    digest;
  const pruneStale =
    'for f in ' +
    base +
    '/*.tar.gz ' +
    base +
    '/upload-*; do [ -f "$f" ] || continue; [ "$f" = "' +
    archive +
    '" ] && continue; rm -f "$f" || :; done';
  return {
    paths,
    installed: sh('if test -f ' + archive + '; then printf present; fi'),
    verified: sh(
      'if test -f ' +
        archive +
        '; then if (' +
        hash(archive) +
        ') 2>/dev/null; then printf verified; else rm -f ' +
        archive +
        ' || :; fi; fi',
    ),
    commit: (source: 'part' | 'temp') => {
      const file = sourceFile(source);
      return sh(
        'set -eu; umask 077; trap "rm -f ' +
          file +
          '" EXIT; test -f ' +
          file +
          '; ' +
          hash(file) +
          '; mv -f ' +
          file +
          ' ' +
          archive +
          '; ' +
          pruneStale,
      );
    },
    upload: (_size: number) =>
      sh(
        'set -eu; umask 077; mkdir -p ' +
          base +
          '; trap "rm -f ' +
          temp +
          '" EXIT; cat > ' +
          temp +
          '; ' +
          hash(temp) +
          '; mv -f ' +
          temp +
          ' ' +
          archive +
          '; ' +
          pruneStale,
      ),
    prepare: sh(
      'set -eu; umask 077; ' +
        hash(archive) +
        '; mkdir ' +
        run +
        '; tar -xzf ' +
        archive +
        ' -C ' +
        run,
    ),
    clean: sh('rm -rf ' + run),
    serve: sh(
      'trap "rm -rf ' +
        run +
        '" EXIT; ' +
        run +
        '/runtime/bin/node ' +
        run +
        '/node_modules/@alune/agent/bin/alune-agent.cjs' +
        arg,
    ),
  };
}
