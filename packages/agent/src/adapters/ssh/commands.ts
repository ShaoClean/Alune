// Shell snippets contain only fixed program text, a validated digest, UUID and numeric port.
// Repository paths, profile fields, credentials and user input never enter a remote command.
const sh = (s: string) => "sh -c '" + s.replaceAll("'", "'\\''") + "'";
const ps = (s: string) =>
  'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' +
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
    temp = base + '/upload-' + nonce;
  const arg = ' serve-remote' + (forwardPort ? ' --git-proxy-port ' + forwardPort : '');
  if (windows) {
    const hash = (file: string) =>
      "(Get-FileHash -LiteralPath '" + file + "' -Algorithm SHA256).Hash.ToLowerInvariant()";
    return {
      installed: ps("if(Test-Path -LiteralPath '" + archive + "'){[Console]::Write('present')}"),
      upload: ps(
        `[IO.Directory]::CreateDirectory('${base}') | Out-Null;
         try {
           $f=[IO.File]::Open('${temp}','CreateNew');
           try { [Console]::OpenStandardInput().CopyTo($f) } finally { $f.Dispose() }
           if (${hash(temp)} -ne '${digest}') { throw 'checksum' }
           Move-Item -Force -LiteralPath '${temp}' -Destination '${archive}';
         } finally { if ([IO.File]::Exists('${temp}')) { [IO.File]::Delete('${temp}') } }
         exit 0`,
      ),
      prepare: ps(
        `if (${hash(archive)} -ne '${digest}') { throw 'checksum' }
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
  return {
    installed: sh('if test -f ' + archive + '; then printf present; fi'),
    upload: sh(
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
        archive,
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
