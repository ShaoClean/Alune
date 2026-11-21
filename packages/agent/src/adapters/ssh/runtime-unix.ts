import type { RuntimeSpec } from './commands';

export function unixCache({ relative, marker, version, protocol }: RuntimeSpec) {
  // Managed launchers emit the packaged CLI's canonical, single-line JSON.
  const expected = JSON.stringify({ name: 'alune-agent', version, protocol });
  return `dest="$HOME/${relative}"
valid() {
  [ -x "$dest/bin/alune-agent" ] &&
  [ "$(cat "$dest/.install-complete" 2>/dev/null)" = '${marker}' ] &&
  probe=$("$dest/bin/alune-agent" --version 2>/dev/null) &&
  [ "$probe" = '${expected}' ]
}`;
}

export function unixInstall(spec: RuntimeSpec) {
  const { marker, sha256, version, protocol, nonce, url, proxy } = spec;
  return `set -eu
umask 077
cd "$HOME"
${unixCache(spec)}
lock="$dest.lock"
stage="$dest.stage-${nonce}"
archive="$stage/archive"
mkdir -p "$(dirname "$dest")"
deadline=$(( $(date +%s) + 600 ))
while ! mkdir "$lock" 2>/dev/null; do
  valid && exit 0
  [ -d "$lock" ] || { echo 'Cannot create install lock: check permissions and free space' >&2; exit 1; }
  for owner in "$lock"/pid-*; do
    [ -f "$owner" ] || continue
    pid=\${owner##*-}
    if ! kill -0 "$pid" 2>/dev/null && rm "$owner" 2>/dev/null; then rmdir "$lock" 2>/dev/null || :; fi
  done
  if find "$lock" -prune -mmin +1 2>/dev/null | grep -q .; then rmdir "$lock" 2>/dev/null || :; fi
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'Install lock timed out' >&2; exit 1; }
  sleep 1
done
owner="$lock/pid-$$"
date +%s > "$owner"
trap 'rm -rf "$stage"; rm -f "$owner"; rmdir "$lock" 2>/dev/null || :' EXIT
trap 'exit 1' HUP INT TERM
valid && exit 0
${proxy === 'blocked' ? "echo 'SSH proxy forwarding blocked' >&2; exit 1" : ''}
mkdir "$stage" "$stage/package"
${typeof proxy === 'number' ? `export http_proxy=http://127.0.0.1:${proxy} https_proxy=http://127.0.0.1:${proxy} no_proxy='' NO_PROXY=''` : ''}
fetch_archive() (
  ulimit -f 524288
  if command -v curl >/dev/null && curl -fsSL --connect-timeout 20 --speed-limit 1 --speed-time 45 --max-time 240 --max-filesize 268435456 -o "$archive" '${url}'; then return; fi
  wget -q --timeout=45 --tries=1 -O "$archive" '${url}'
)
fetch_archive || { echo 'Download unavailable: preinstall matching alune-agent or configure ALUNE_AGENT_RELEASE_MIRROR' >&2; exit 1; }
echo ALUNE_VERIFY >&2
[ "$(wc -c < "$archive")" -le 268435456 ]
if command -v sha256sum >/dev/null; then hash=$(sha256sum "$archive"); else hash=$(shasum -a 256 "$archive"); fi
[ "\${hash%% *}" = '${sha256}' ] || { echo 'SSH archive checksum mismatch' >&2; exit 1; }
tar -xzf "$archive" -C "$stage/package"
cd "$stage/package"
./bin/alune-agent --version > ../probe.json
./runtime/bin/node -e 'const p=require("../probe.json"); if(p.name!=="alune-agent" || p.version!=="${version}" || p.protocol?.major!==${protocol.major} || p.protocol.minor!==${protocol.minor}) throw Error("Agent version mismatch")'
printf 'ready\\n'
IFS= read -r decision && [ "$decision" = publish ] || { echo 'Installation cancelled' >&2; exit 1; }
printf '%s' '${marker}' > .install-complete
cd "$HOME"
if [ -e "$dest" ]; then mv "$dest" "$stage/invalid"; fi
mv "$stage/package" "$dest"`;
}
