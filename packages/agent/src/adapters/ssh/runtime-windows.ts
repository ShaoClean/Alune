import type { RuntimeSpec } from './commands';

export function windowsCache({ relative, marker, version, protocol }: RuntimeSpec) {
  return `$dest=Join-Path $env:USERPROFILE '${relative}'
function Valid {
  try {
    if (!(Test-Path "$dest/bin/alune-agent.cmd" -PathType Leaf) -or [IO.File]::ReadAllText("$dest/.install-complete") -cne '${marker}') { return $false }
    $p=(& "$dest/bin/alune-agent.cmd" --version | ConvertFrom-Json)
    return ($LASTEXITCODE -eq 0 -and $p.name -ceq 'alune-agent' -and $p.version -ceq '${version}' -and $p.protocol.major -eq ${protocol.major} -and $p.protocol.minor -eq ${protocol.minor})
  } catch { return $false }
}`;
}

export function windowsInstall(spec: RuntimeSpec) {
  const { marker, sha256, version, protocol, nonce, url, proxy } = spec;
  return `${windowsCache(spec)}
$stage="$dest.stage-${nonce}"
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest)) | Out-Null
$deadline=[DateTime]::UtcNow.AddMinutes(10)
while (!$lock) {
  try { $lock=[IO.File]::Open("$dest.lock",'OpenOrCreate','ReadWrite','None') }
  catch [IO.IOException] { if (Valid) { exit 0 }; if ([DateTime]::UtcNow -gt $deadline) { throw 'Install lock timed out' }; Start-Sleep -Seconds 1 }
}
try {
  if (Valid) { exit 0 }
  $owner=[Text.Encoding]::UTF8.GetBytes("$PID $([DateTime]::UtcNow.ToString('o'))")
  $lock.SetLength(0); $lock.Write($owner,0,$owner.Length)
  ${proxy === 'blocked' ? "throw 'SSH proxy forwarding blocked'" : ''}
  [IO.Directory]::CreateDirectory("$stage/package") | Out-Null
  $req=[Net.HttpWebRequest]::Create('${url}')
  $req.Timeout=20000; $req.ReadWriteTimeout=45000
  ${typeof proxy === 'number' ? `$req.Proxy=New-Object Net.WebProxy('http://127.0.0.1:${proxy}', $false)` : ''}
  try {
    $response=$req.GetResponse()
    try {
      $inputStream=$response.GetResponseStream()
      $file=[IO.File]::Create("$stage/archive")
      try {
        $buffer=New-Object byte[] 65536
        $end=[DateTime]::UtcNow.AddMinutes(4)
        while (($n=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
          if ($file.Length+$n -gt 268435456 -or [DateTime]::UtcNow -gt $end) { throw 'Download limit exceeded' }
          $file.Write($buffer,0,$n)
        }
      } finally { $file.Dispose() }
    } finally { $response.Dispose() }
  } catch { throw "Download failed: preinstall matching Agent or configure ALUNE_AGENT_RELEASE_MIRROR. $_" }
  [Console]::Error.WriteLine('ALUNE_VERIFY')
  $sha=[Security.Cryptography.SHA256]::Create(); $f=[IO.File]::OpenRead("$stage/archive")
  try { $hash=[BitConverter]::ToString($sha.ComputeHash($f)).Replace('-','') } finally { $f.Dispose(); $sha.Dispose() }
  if ($hash -ne '${sha256}') { throw 'SSH archive checksum mismatch' }
  & "$env:SystemRoot/System32/tar.exe" -xzf "$stage/archive" -C "$stage/package"
  if ($LASTEXITCODE) { throw 'Archive extraction failed; check permissions and free space' }
  $p=(& "$stage/package/bin/alune-agent.cmd" --version | ConvertFrom-Json)
  if ($LASTEXITCODE -or $p.name -cne 'alune-agent' -or $p.version -cne '${version}' -or $p.protocol.major -ne ${protocol.major} -or $p.protocol.minor -ne ${protocol.minor}) { throw 'Agent version mismatch' }
  [Console]::WriteLine('ready'); [Console]::Out.Flush()
  if ([Console]::ReadLine() -cne 'publish') { throw 'Installation cancelled' }
  [IO.File]::WriteAllText("$stage/package/.install-complete",'${marker}')
  if ([IO.Directory]::Exists($dest)) {
    try { [IO.Directory]::Move($dest,"$stage/invalid") } catch { throw 'Close active connections to this Agent version and retry' }
  }
  [IO.Directory]::Move("$stage/package",$dest)
} finally {
  try { if (Test-Path $stage) { Remove-Item -Force -Recurse -LiteralPath $stage } } finally { $lock.Dispose() }
}`;
}
