import { gzipSync } from 'node:zlib';
import { PROTOCOL_VERSION } from '@alune/protocol';
import type { readBundle } from './bundles';
import { unixCache, unixInstall } from './runtime-unix';
import { windowsCache, windowsInstall } from './runtime-windows';

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
      serve: (system?: string) => {
        if (system && (!/^[A-Za-z]:[\\/]/.test(system) || /[\r\n\x00'"‘’“”]/.test(system)))
          throw Error('Invalid system Agent path');
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
    serve: (system?: string) => {
      if (system && (!system.startsWith('/') || /[\r\n\x00]/.test(system)))
        throw Error('Invalid system Agent path');
      return sh('exec ' + (system ? "'" + system.replaceAll("'", "'\\''") + "'" : entry) + args);
    },
  };
}
