import type { DaemonAction } from '../../bootstrap/daemon';
import { gzipSync } from 'node:zlib';
import { PROTOCOL_VERSION } from '@alune/protocol';
import type { readBundle } from './bundles';
import { unixCache, unixInstall } from './runtime-unix';
import { windowsCache, windowsInstall } from './runtime-windows';

const sh = (s: string) => "sh -c '" + s.replaceAll("'", "'\\''") + "'";
const ps = (s: string) =>
  'powershell.exe -NoLogo -NoProfile -NonInteractive -InputFormat None -OutputFormat Text -EncodedCommand ' +
  Buffer.from(
    "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Environment]::CurrentDirectory=(Get-Location).ProviderPath;try {" +
      s +
      '\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',
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

type Bundle = Awaited<ReturnType<typeof readBundle>>;
export type RuntimeSpec = Bundle & {
  relative: string;
  marker: string;
  nonce: string;
  protocol: typeof PROTOCOL_VERSION;
  proxy?: number | 'blocked';
};

export function runtimeCommands(bundle: Bundle, nonce: string, proxy?: number | 'blocked') {
  const { version, target, sha256 } = bundle;
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$/.test(version) ||
    !['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'].includes(target) ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !/^[a-f0-9-]{36}$/.test(nonce) ||
    (typeof proxy === 'number' && (!Number.isInteger(proxy) || proxy < 1 || proxy > 65535))
  )
    throw Error('Invalid runtime identifiers');
  const relative = `.alune-ssh/runtime/versions/${version}/${target}`;
  const marker = JSON.stringify({ version, target, sha256 });
  const spec = {
    ...bundle,
    url: bundle.url.replaceAll("'", '%27'),
    relative,
    marker,
    nonce,
    protocol: PROTOCOL_VERSION,
    proxy,
  };
  const actionArgs = (pid?: number, action?: DaemonAction) => {
    if (action && !['logs', 'versions', 'clean', 'restart', 'stop'].includes(action))
      throw Error('Invalid action');
    if (pid !== undefined && (!Number.isSafeInteger(pid) || pid < 1))
      throw Error('Invalid daemon PID');
    return action ? 'daemon ' + action : 'ensure-daemon' + (pid ? ' ' + pid : '');
  };
  const args = ' serve-remote' + (proxy ? ' --git-proxy-port ' + proxy : '');
  if (target === 'win32-x64') {
    const entry = `(Join-Path $env:USERPROFILE '${relative}/bin/alune-agent.cmd')`;
    const compressed = gzipSync(windowsInstall(spec)).toString('base64');
    return {
      probe: ps(
        '[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $exe=(Get-Command alune-agent -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source; [Console]::WriteLine($exe); & $exe --version; exit $LASTEXITCODE',
      ),
      cache: ps(`${windowsCache(spec)}; if (Valid) { [Console]::Write('present') }`),
      install: ps(
        `$ms=New-Object IO.MemoryStream(,[Convert]::FromBase64String('${compressed}')); $gz=New-Object IO.Compression.GZipStream($ms,[IO.Compression.CompressionMode]::Decompress); & ([scriptblock]::Create((New-Object IO.StreamReader($gz)).ReadToEnd()))`,
      ),
      serve: (system?: string, daemon = false, pid?: number, action?: DaemonAction) => {
        if (system && (!/^[A-Za-z]:[\\/]/.test(system) || /[\r\n\x00'"‘’“”]/.test(system)))
          throw Error('Invalid system Agent path');
        if (daemon)
          return ps(`$dir=Join-Path $env:USERPROFILE '.alune-ssh/daemon'
          [IO.Directory]::CreateDirectory($dir) | Out-Null
          $deadline=[DateTime]::UtcNow.AddSeconds(30)
          while (!$lock) {try {$lock=[IO.File]::Open("$dir/launch.lock",'OpenOrCreate','ReadWrite','None')} catch [IO.IOException] {if ([DateTime]::UtcNow -gt $deadline) {throw 'Daemon launch lock timed out'}; Start-Sleep -Milliseconds 100}}
          try { & ${system ? "'" + system + "'" : entry} ${actionArgs(pid, action)}; exit $LASTEXITCODE } finally {$lock.Dispose()}`);
        // Inherit the SSH byte streams directly, including under Windows PowerShell 5.1.
        return ps(`$info=New-Object Diagnostics.ProcessStartInfo;
          $info.UseShellExecute=$false;
          $info.FileName=$env:ComSpec;
          $info.EnvironmentVariables['ALUNE_REMOTE_ENTRY']=${system ? "'" + system + "'" : entry};
          $info.Arguments='/d /v:off /s /c ""%ALUNE_REMOTE_ENTRY%"${args}"';
          $child=[Diagnostics.Process]::Start($info); $child.WaitForExit(); exit $child.ExitCode`);
      },
    };
  }
  const entry = `"$HOME/${relative}/bin/alune-agent"`;
  return {
    probe: sh(
      'PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"; export PATH; p=$(command -v alune-agent) || exit 1; case "$p" in /*) printf "%s\\n" "$p"; "$p" --version;; *) exit 1;; esac',
    ),
    cache: sh(`${unixCache(spec)}; if valid; then printf present; fi`),
    install: sh(unixInstall(spec)),
    serve: (system?: string, daemon = false, confirmedPid?: number, action?: DaemonAction) => {
      if (system && (!system.startsWith('/') || /[\r\n\x00]/.test(system)))
        throw Error('Invalid system Agent path');
      const executable = system ? "'" + system.replaceAll("'", "'\\''") + "'" : entry;
      if (!daemon) return sh('exec ' + executable + args);
      return sh(`set -eu
umask 077
dir="$HOME/.alune-ssh/daemon"
mkdir -p "$dir"
chmod 700 "$dir"
lock="$dir/.launch.lock"
deadline=$(( $(date +%s) + 30 ))
while ! mkdir "$lock" 2>/dev/null; do
  for owner in "$lock"/pid-*; do
    [ -f "$owner" ] || continue
    pid=\${owner##*-}
    if ! kill -0 "$pid" 2>/dev/null && rm "$owner" 2>/dev/null; then rmdir "$lock" 2>/dev/null || :; fi
  done
  if find "$lock" -prune -mmin +1 2>/dev/null | grep -q .; then rmdir "$lock" 2>/dev/null || :; fi
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'Daemon launch lock timed out' >&2; exit 1; }
  sleep 1
done
owner="$lock/pid-$$"
trap 'rm -f "$owner"; rmdir "$lock" || :' EXIT
trap 'exit 1' HUP INT TERM
date +%s > "$owner"
${executable} ${actionArgs(confirmedPid, action)}`);
    },
  };
}
